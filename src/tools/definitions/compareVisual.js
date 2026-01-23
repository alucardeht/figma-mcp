import { z } from 'zod';
import { compareImages, getImageDimensions } from '../../services/imageComparator.js';

export const name = 'compare_visual';

export const description = `Pixel-by-pixel visual comparison between Figma and browser screenshots. Returns match_score (0-100), status, problematic regions (9-grid), fix recommendations. Default pass: 90%.`;

const viewportObject = z.object({
  width: z.number(),
  height: z.number()
});

export const inputSchema = {
  figma_file_key: z.string().describe('Figma file key from URL'),
  figma_frame_name: z.string().optional().describe('Frame name to compare against (partial match)'),
  figma_node_id: z.string().optional().describe('Alternative: specific node ID instead of frame name'),
  browser_screenshot_base64: z.string().describe('Base64 encoded browser screenshot (from chrome-devtools.take_screenshot)'),
  viewport: viewportObject.describe('Viewport dimensions that screenshot was taken at (must match Figma frame)'),
  threshold: z.number().default(0.1).describe('Pixel difference threshold 0-1 (default: 0.1, lower = stricter)'),
  pass_threshold: z.number().default(90).describe('Match percentage needed to PASS (default: 90%)')
};

function generateRecommendations(regions) {
  const recommendations = [];

  const hasCritical = regions.some(r => r.severity === 'critical');
  const hasModerate = regions.some(r => r.severity === 'moderate');

  if (hasCritical) {
    recommendations.push('Check for missing elements in critical regions');
    recommendations.push('Verify all images and icons are loading correctly');
  }

  if (hasModerate) {
    recommendations.push('Check font family and weight matches Figma');
    recommendations.push('Verify colors are exact hex values from Figma');
    recommendations.push('Check spacing and padding values');
  }

  for (const region of regions.slice(0, 3)) {
    if (region.area.includes('top')) {
      recommendations.push(`Check header/navigation area (${region.area})`);
    } else if (region.area.includes('bottom')) {
      recommendations.push(`Check footer area (${region.area})`);
    } else if (region.area === 'center') {
      recommendations.push('Check main content area positioning');
    }
  }

  return [...new Set(recommendations)];
}

export async function handler(args, ctx) {
  const { chunker, figmaClient, session } = ctx;
  const {
    figma_file_key,
    figma_frame_name,
    figma_node_id,
    browser_screenshot_base64,
    viewport,
    threshold,
    pass_threshold
  } = args;

  if (!browser_screenshot_base64) {
    throw new Error('browser_screenshot_base64 is required - get it from chrome-devtools.take_screenshot()');
  }

  if (!viewport || !viewport.width || !viewport.height) {
    throw new Error('viewport {width, height} is required - must match Figma frame dimensions');
  }

  try {
    let figmaImageBuffer;

    if (figma_node_id) {
      const imageData = await figmaClient.getImage(figma_file_key, figma_node_id, 'png', 1);
      const imageUrl = imageData.images[figma_node_id];
      const response = await fetch(imageUrl);
      figmaImageBuffer = Buffer.from(await response.arrayBuffer());
    } else if (figma_frame_name) {
      const frameData = session.getCachedData(`frame_${figma_frame_name}`);
      if (frameData && frameData.nodeId) {
        const imageData = await figmaClient.getImage(figma_file_key, frameData.nodeId, 'png', 1);
        const imageUrl = imageData.images[frameData.nodeId];
        const response = await fetch(imageUrl);
        figmaImageBuffer = Buffer.from(await response.arrayBuffer());
      } else {
        throw new Error(`Frame "${figma_frame_name}" not found in session. Call get_frame_info first.`);
      }
    } else {
      throw new Error('Either figma_node_id or figma_frame_name is required');
    }

    const browserImageBuffer = Buffer.from(browser_screenshot_base64, 'base64');

    const figmaDimensions = await getImageDimensions(figmaImageBuffer);
    const browserDimensions = await getImageDimensions(browserImageBuffer);

    const dimensionWarnings = [];
    if (figmaDimensions.width !== viewport.width || figmaDimensions.height !== viewport.height) {
      dimensionWarnings.push(`Figma image (${figmaDimensions.width}x${figmaDimensions.height}) doesn't match expected viewport (${viewport.width}x${viewport.height})`);
    }
    if (browserDimensions.width !== viewport.width || browserDimensions.height !== viewport.height) {
      dimensionWarnings.push(`Browser screenshot (${browserDimensions.width}x${browserDimensions.height}) doesn't match expected viewport (${viewport.width}x${viewport.height})`);
    }

    const comparison = await compareImages(figmaImageBuffer, browserImageBuffer, { threshold });

    if (!comparison.success) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'ERROR',
            error: comparison.error,
            message: comparison.message,
            details: comparison.details,
            hint: comparison.error === 'DIMENSION_MISMATCH'
              ? 'Use chrome-devtools.resize_page() to match Figma dimensions exactly'
              : 'Check that both images are valid'
          }, null, 2)
        }]
      };
    }

    const passed = comparison.matchScore >= pass_threshold;

    const result = {
      status: passed ? 'PASS' : 'FAIL',
      match_score: comparison.matchScore,
      pass_threshold,
      dimensions: comparison.dimensions,
      mismatched_pixels: comparison.mismatchedPixels,
      total_pixels: comparison.totalPixels,
      problematic_regions: comparison.regions,
      warnings: dimensionWarnings.length > 0 ? dimensionWarnings : undefined
    };

    if (!passed) {
      result.recommendations = generateRecommendations(comparison.regions);
      result.summary = `Visual match ${comparison.matchScore}% (need ${pass_threshold}%). ${comparison.regions.length} problematic region(s) detected.`;
    } else {
      result.summary = `Visual match ${comparison.matchScore}% - PASSED`;
    }

    const response = chunker ? chunker.wrapResponse(result, {
      step: 'Visual comparison',
      progress: `Compared ${comparison.totalPixels} pixels`,
      nextStep: passed ? 'Proceed to next section' : 'Fix visual issues and revalidate'
    }) : result;

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ERROR',
          error: error.message,
          hint: 'Make sure Figma file_key is valid and frame exists'
        }, null, 2)
      }]
    };
  }
}
