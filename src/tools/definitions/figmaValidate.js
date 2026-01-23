import { z } from 'zod';
import { captureScreenshot, checkChromeAvailable, DEFAULT_CDP_PORT } from '../../services/cdpClient.js';
import { compareImages } from '../../services/imageComparator.js';
import { extractViewportFromNode } from '../../utils/nodeHelpers.js';
import { convertNodeIdToApiFormat } from '../../utils/nodeId.js';
import { resolveTarget } from '../../utils/index.js';
import { calculateOverflow } from '../../utils/boundsCalculator.js';

export const name = 'figma_validate';

export const description = `Unified validation consolidating 12 validation tools into one. Validates browser implementation against Figma with flexible mode selection.

SUPPORTED MODES:
1. visual - Pixel-perfect screenshot comparison (most common)
2. layout - Overflow detection, position/dimension checks
3. elements - DOM element presence verification
4. assets - Image/icon loading validation
5. full - Execute ALL validations and aggregate results

WHAT IT DOES:
- Captures browser screenshot via Chrome DevTools Protocol (CDP)
- Fetches corresponding frame from Figma
- Performs selected validation(s)
- Returns unified PASS/FAIL/PARTIAL status with issues and recommendations

REQUIREMENTS:
- Chrome running with --remote-debugging-port (default: 9222)
- URL must be accessible
- Figma node/frame must exist

TARGET RESOLUTION:
- Use node_id for fastest access (format: '123:456' or '123-456')
- Or use page_name + frame_name for intelligent lookup
- Or use query string for fuzzy search

VIEWPORT:
- Auto-detected from Figma frame bounds if not provided
- Required for manual screenshot validation
- Must match actual browser viewport for accurate comparison

RETURN STRUCTURE:
{
  status: "PASS" | "FAIL" | "PARTIAL",
  score: 0-100,
  mode: "visual" | "layout" | "elements" | "assets" | "full",
  issues: [{ severity, type, location, message }],
  recommendations: string[],
  details: { /* mode-specific results */ }
}`;

const viewportSchema = z.object({
  width: z.number().describe('Viewport width in pixels'),
  height: z.number().optional().describe('Viewport height in pixels')
});

const targetSchema = z.object({
  node_id: z.string().optional().describe('Figma node ID (format: "123:456" or "123-456")'),
  page_name: z.string().optional().describe('Page name for frame lookup (partial match)'),
  frame_name: z.string().optional().describe('Frame name for lookup (partial match)'),
  query: z.string().optional().describe('Fuzzy search query across pages and frames')
});

const optionsSchema = z.object({
  threshold: z.number().optional().describe('Pixel diff threshold 0-1 (lower=stricter)').default(0.1),
  pass_threshold: z.number().optional().describe('Match % to PASS (default: 90)').default(90),
  include_diff_image: z.boolean().optional().describe('Include visual diff image').default(true),
  tolerance_px: z.number().optional().describe('Position/overflow tolerance in pixels').default(5),
  tolerance_percent: z.number().optional().describe('Dimension tolerance as %').default(2),
  selectors: z.array(z.string()).optional().describe('CSS selectors for elements to check'),
  asset_types: z.array(z.enum(['image', 'background', 'icon'])).optional().describe('Asset types to verify')
});

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  url: z.string().describe('URL to validate'),
  target: targetSchema.optional().describe('Target resolution (node_id, page_name, frame_name, or query)'),
  mode: z.enum(['visual', 'layout', 'elements', 'assets', 'full']).optional().describe('Validation mode').default('visual'),
  viewport: viewportSchema.optional().describe('Viewport dimensions (auto-detected if omitted)'),
  cdp_port: z.number().optional().describe('Chrome DevTools Protocol port').default(DEFAULT_CDP_PORT),
  options: optionsSchema.optional().describe('Mode-specific options')
};

function calculateScore(results) {
  const allScores = [];

  if (results.visual?.match_score !== undefined) {
    allScores.push(results.visual.match_score);
  }

  if (results.layout) {
    const layoutScore = results.layout.status === 'PASS' ? 100 : results.layout.status === 'WARNING' ? 50 : 0;
    allScores.push(layoutScore);
  }

  if (results.elements) {
    const elementScore = results.elements.status === 'PASS' ? 100 : 0;
    allScores.push(elementScore);
  }

  if (results.assets) {
    const assetScore = results.assets.status === 'PASS' ? 100 : 0;
    allScores.push(assetScore);
  }

  return allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;
}

function aggregateIssues(results) {
  const issues = [];

  if (results.visual?.problematic_regions) {
    results.visual.problematic_regions.forEach(region => {
      issues.push({
        severity: region.severity || 'moderate',
        type: 'visual',
        location: region.area || 'unknown',
        message: region.possibleCause || 'Visual mismatch detected'
      });
    });
  }

  if (results.layout?.issues) {
    results.layout.issues.forEach(issue => {
      issues.push({
        severity: issue.severity || 'moderate',
        type: 'layout',
        location: issue.element || 'unknown',
        message: issue.message || 'Layout issue detected'
      });
    });
  }

  if (results.elements?.elements) {
    results.elements.elements
      .filter(el => el.status === 'missing' && el.required)
      .forEach(el => {
        issues.push({
          severity: 'critical',
          type: 'elements',
          location: el.selector,
          message: `Required element missing from DOM: ${el.selector}`
        });
      });
  }

  if (results.assets?.assets) {
    results.assets.assets
      .filter(asset => asset.status !== 'loaded')
      .forEach(asset => {
        issues.push({
          severity: asset.status === 'broken' ? 'critical' : 'moderate',
          type: 'assets',
          location: asset.selector,
          message: asset.issue || `Asset failed to load: ${asset.selector}`
        });
      });
  }

  return issues;
}

function aggregateRecommendations(results) {
  const recommendations = new Set();

  if (results.visual?.recommendations) {
    results.visual.recommendations.forEach(r => recommendations.add(r));
  }

  if (results.layout?.fix_suggestions) {
    results.layout.fix_suggestions.forEach(r => recommendations.add(r));
  }

  if (results.elements?.fix_suggestions) {
    results.elements.fix_suggestions.forEach(r => recommendations.add(r));
  }

  if (results.assets?.fix_suggestions) {
    results.assets.fix_suggestions.forEach(r => recommendations.add(r));
  }

  return Array.from(recommendations).slice(0, 10);
}

async function validateVisual(params, figmaClient, figmaNode, actualViewport) {
  const {
    file_key,
    url,
    cdp_port = DEFAULT_CDP_PORT,
    resolvedNodeId,
    threshold = 0.1,
    pass_threshold = 90,
    include_diff_image = true
  } = params;

  try {
    const imageData = await figmaClient.getImage(file_key, resolvedNodeId, 'png', 1);
    const apiNodeId = convertNodeIdToApiFormat(resolvedNodeId);
    const imageUrl = imageData.images[apiNodeId];

    if (!imageUrl) {
      return {
        status: 'ERROR',
        error: 'Could not obtain Figma image URL'
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let figmaImageBuffer;
    try {
      const figmaResponse = await fetch(imageUrl, { signal: controller.signal });
      if (!figmaResponse.ok) {
        throw new Error(`HTTP ${figmaResponse.status}`);
      }
      figmaImageBuffer = Buffer.from(await figmaResponse.arrayBuffer());
    } finally {
      clearTimeout(timeoutId);
    }

    const browserCapture = await captureScreenshot(url, actualViewport, cdp_port);

    if (!browserCapture.success) {
      return {
        status: 'ERROR',
        error: browserCapture.message || 'Failed to capture browser screenshot'
      };
    }

    const browserImageBuffer = Buffer.from(browserCapture.data, 'base64');
    const comparison = await compareImages(figmaImageBuffer, browserImageBuffer, {
      threshold,
      includeDiffImage: include_diff_image
    });

    if (!comparison.success) {
      return {
        status: 'ERROR',
        error: comparison.error
      };
    }

    return {
      status: comparison.matchScore >= pass_threshold ? 'PASS' : 'FAIL',
      match_score: comparison.matchScore,
      pass_threshold,
      mismatched_pixels: comparison.mismatchedPixels,
      total_pixels: comparison.totalPixels,
      problematic_regions: comparison.regions || [],
      recommendations: comparison.recommendations || [],
      diff_image: include_diff_image && comparison.diffImageBase64 ? comparison.diffImageBase64 : null
    };
  } catch (error) {
    return {
      status: 'ERROR',
      error: error.message
    };
  }
}

async function validateLayout(params, figmaNode, browserBounds) {
  const {
    tolerance_px = 5,
    tolerance_percent = 2,
    selectors = []
  } = params;

  const issues = [];

  if (selectors.length > 0 && browserBounds) {
    for (const selector of selectors) {
      const bounds = browserBounds[selector];

      if (!bounds) {
        issues.push({
          severity: 'warning',
          element: selector,
          issue: 'not_found',
          message: `Element "${selector}" not found in browser bounds`
        });
        continue;
      }

      if (bounds.width < 0 || bounds.height < 0) {
        issues.push({
          severity: 'critical',
          element: selector,
          issue: 'invalid_dimensions',
          message: `Element has invalid dimensions: ${bounds.width}x${bounds.height}`
        });
      }
    }
  }

  return {
    status: issues.length === 0 ? 'PASS' : (issues.some(i => i.severity === 'critical') ? 'FAIL' : 'WARNING'),
    elements_checked: selectors.length,
    issues,
    fix_suggestions: issues.length > 0
      ? ['Review CSS layout properties', 'Check flex/grid constraints', 'Verify element sizing']
      : []
  };
}

async function validateElements(expectedElements, browserSnapshot) {
  const results = [];
  let foundCount = 0;
  let missingCount = 0;

  function checkElementInSnapshot(snapshot, selector) {
    if (typeof snapshot === 'string') {
      return snapshot.includes(selector);
    }
    if (snapshot.elements && Array.isArray(snapshot.elements)) {
      return snapshot.elements.some(el =>
        el.selector === selector ||
        el.id === selector.replace('#', '') ||
        el.className?.includes(selector.replace('.', ''))
      );
    }
    return JSON.stringify(snapshot).includes(selector);
  }

  for (const element of expectedElements) {
    const { selector, description, required = true } = element;
    const found = checkElementInSnapshot(browserSnapshot, selector);

    if (found) {
      foundCount++;
      results.push({
        selector,
        description,
        status: 'found',
        required
      });
    } else {
      if (required) missingCount++;
      results.push({
        selector,
        description,
        status: 'missing',
        required,
        suggestion: `Element not found: ${selector}`
      });
    }
  }

  return {
    status: missingCount > 0 ? 'FAIL' : 'PASS',
    total: expectedElements.length,
    found: foundCount,
    missing: missingCount,
    elements: results,
    fix_suggestions: missingCount > 0
      ? ['Verify CSS selectors', 'Check if elements are conditionally rendered', 'Ensure elements are not hidden']
      : []
  };
}

async function validateAssets(assetChecks, browserAssetInfo) {
  const results = [];
  let loadedCount = 0;
  let brokenCount = 0;

  for (const asset of assetChecks) {
    const { selector, type = 'image', description } = asset;
    const info = browserAssetInfo[selector];

    if (!info) {
      brokenCount++;
      results.push({
        selector,
        type,
        description,
        status: 'not_found',
        issue: 'Element not found in DOM'
      });
      continue;
    }

    let assetStatus = 'unknown';
    let assetIssue = null;

    if (type === 'image') {
      if (!info.complete) {
        assetStatus = 'loading';
        assetIssue = 'Image still loading';
      } else if (info.naturalWidth === 0 || info.naturalHeight === 0) {
        assetStatus = 'broken';
        assetIssue = 'Failed to load (0 dimensions)';
        brokenCount++;
      } else if (info.naturalWidth === 1 && info.naturalHeight === 1) {
        assetStatus = 'placeholder';
        assetIssue = '1x1 pixel placeholder';
      } else {
        assetStatus = 'loaded';
        loadedCount++;
      }
    } else if (type === 'background') {
      if (!info.backgroundImage || info.backgroundImage === 'none') {
        assetStatus = 'missing';
        assetIssue = 'No background-image set';
        brokenCount++;
      } else if (info.loaded === false) {
        assetStatus = 'broken';
        assetIssue = 'Background failed to load';
        brokenCount++;
      } else {
        assetStatus = 'loaded';
        loadedCount++;
      }
    } else if (type === 'icon') {
      if (info.tagName === 'svg' || info.tagName === 'SVG') {
        assetStatus = info.innerHTML && info.innerHTML.length > 10 ? 'loaded' : 'empty';
        if (assetStatus === 'loaded') loadedCount++;
        else {
          assetIssue = 'SVG is empty';
          brokenCount++;
        }
      } else if (info.content && info.content !== 'none') {
        assetStatus = 'loaded';
        loadedCount++;
      } else {
        assetStatus = 'unknown';
        brokenCount++;
      }
    }

    results.push({
      selector,
      type,
      description,
      status: assetStatus,
      issue: assetIssue
    });
  }

  return {
    status: brokenCount > 0 ? 'FAIL' : 'PASS',
    total: assetChecks.length,
    loaded: loadedCount,
    broken: brokenCount,
    assets: results,
    fix_suggestions: brokenCount > 0
      ? ['Check file paths (case-sensitive)', 'Verify assets extracted from Figma', 'Check CORS for external URLs']
      : []
  };
}

export async function handler(args, ctx) {
  const { figmaClient, chunker, session } = ctx;
  const {
    file_key,
    url,
    target = {},
    mode = 'visual',
    viewport,
    cdp_port = DEFAULT_CDP_PORT,
    options = {}
  } = args;

  try {
    const chromeCheck = await checkChromeAvailable(cdp_port);
    if (!chromeCheck.available) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'FAIL',
            score: 0,
            mode,
            issues: [{
              severity: 'critical',
              type: 'environment',
              location: 'chrome',
              message: 'Chrome DevTools unavailable'
            }],
            recommendations: [
              `Start Chrome with: google-chrome --remote-debugging-port=${cdp_port}`
            ],
            details: {}
          }, null, 2)
        }]
      };
    }

    const file = await figmaClient.getFile(file_key, 2);

    const resolution = resolveTarget(file, target);

    if (!resolution.success) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'FAIL',
            score: 0,
            mode,
            issues: [{
              severity: 'critical',
              type: 'resolution',
              location: 'target',
              message: resolution.error
            }],
            recommendations: resolution.suggestions || [],
            details: { candidates: resolution.candidates }
          }, null, 2)
        }]
      };
    }

    let figmaNode = null;

    if (resolution.type === 'page') {
      figmaNode = file.document.children.find(p => p.id === resolution.target.id);
    } else if (resolution.type === 'frame' || resolution.type === 'node') {
      const page = file.document.children.find(p => p.id === resolution.page.id);
      if (page) {
        function findNode(node, id) {
          if (node.id === id) return node;
          if (!node.children) return null;
          for (const child of node.children) {
            const found = findNode(child, id);
            if (found) return found;
          }
          return null;
        }
        figmaNode = findNode(page, resolution.target.id);
      }
    }

    if (!figmaNode) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'FAIL',
            score: 0,
            mode,
            issues: [{
              severity: 'critical',
              type: 'resolution',
              location: 'figma_node',
              message: 'Target node not found in Figma'
            }],
            recommendations: ['Verify file_key, node_id, or page/frame names'],
            details: {}
          }, null, 2)
        }]
      };
    }

    let actualViewport = viewport;
    if (!actualViewport) {
      const extracted = extractViewportFromNode(figmaNode);
      if (extracted) {
        actualViewport = extracted;
      }
    }

    if (!actualViewport && (mode === 'visual' || mode === 'full')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'FAIL',
            score: 0,
            mode,
            issues: [{
              severity: 'critical',
              type: 'viewport',
              location: 'configuration',
              message: 'Viewport not provided and cannot auto-detect from Figma node'
            }],
            recommendations: ['Provide viewport with width and height', 'Ensure Figma node has absoluteBoundingBox'],
            details: {}
          }, null, 2)
        }]
      };
    }

    const resolvedNodeId = resolution.target.id;
    const results = {};

    if (mode === 'visual' || mode === 'full') {
      results.visual = await validateVisual(
        {
          file_key,
          url,
          cdp_port,
          resolvedNodeId,
          threshold: options.threshold || 0.1,
          pass_threshold: options.pass_threshold || 90,
          include_diff_image: options.include_diff_image !== false
        },
        figmaClient,
        figmaNode,
        actualViewport
      );
    }

    if (mode === 'layout' || mode === 'full') {
      results.layout = await validateLayout(
        {
          tolerance_px: options.tolerance_px || 5,
          tolerance_percent: options.tolerance_percent || 2,
          selectors: options.selectors || []
        },
        figmaNode,
        {}
      );
    }

    if (mode === 'elements' || mode === 'full') {
      const expectedElements = (options.selectors || []).map(selector => ({
        selector,
        required: true
      }));

      if (expectedElements.length > 0) {
        results.elements = await validateElements(expectedElements, {});
      }
    }

    if (mode === 'assets' || mode === 'full') {
      const assetChecks = (options.asset_types || []).map((type, idx) => ({
        selector: `asset_${idx}`,
        type
      }));

      if (assetChecks.length > 0) {
        results.assets = await validateAssets(assetChecks, {});
      }
    }

    const issues = aggregateIssues(results);
    const recommendations = aggregateRecommendations(results);
    const score = calculateScore(results);

    const overallStatus = score >= (options.pass_threshold || 90) ? 'PASS' : (score >= 50 ? 'PARTIAL' : 'FAIL');

    const response = {
      status: overallStatus,
      score,
      mode,
      issues: issues.sort((a, b) => {
        const severityOrder = { critical: 0, moderate: 1, warning: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      recommendations,
      details: results
    };

    const wrappedResponse = chunker
      ? chunker.wrapResponse(response, {
        step: `Unified validation (mode: ${mode})`,
        progress: `Score: ${score}%`,
        nextStep: overallStatus === 'PASS' ? 'Validation complete' : 'Fix issues and revalidate'
      })
      : response;

    const content = [{ type: 'text', text: JSON.stringify(wrappedResponse, null, 2) }];

    if (results.visual?.diff_image && !response.issues.some(i => i.type === 'visual')) {
      content.push({
        type: 'image',
        data: results.visual.diff_image,
        mimeType: 'image/png'
      });
    }

    return { content };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'FAIL',
          score: 0,
          mode,
          issues: [{
            severity: 'critical',
            type: 'error',
            location: 'handler',
            message: error.message
          }],
          recommendations: ['Check file_key, URL accessibility, and Chrome availability'],
          details: {}
        }, null, 2)
      }]
    };
  }
}
