import { z } from 'zod';
import { captureScreenshot, captureScreenshotRegion, checkChromeAvailable, DEFAULT_CDP_PORT } from '../../services/cdpClient.js';
import { compareImages } from '../../services/imageComparator.js';
import { extractViewportFromNode } from '../../utils/nodeHelpers.js';
import { convertNodeIdToApiFormat } from '../../utils/nodeId.js';
import {
  needsChunking,
  calculateChunkGrid,
  extractFigmaChunk,
  generateDiffThumbnail,
  consolidateChunkResults,
  generateGridMap,
  generateChunkedRecommendations,
  CHUNK_THRESHOLD,
  DEFAULT_CHUNK_SIZE
} from '../../utils/chunkedValidation.js';
import {
  extractCssTree,
  buildSectionLegend,
  buildDependencyMap,
  calculateImplementationOrder,
  determineSectionStatus,
  determineOverallStatus,
  analyzeSectionProblems
} from './sectionHelpers.js';
import { groupNodesBySection, findTransitionElements } from '../pageStructure.js';
import sharp from 'sharp';

export const name = 'validate_implementation';
export const description = `Validate browser implementation against Figma in ONE call with pixel-perfect visual comparison.

WHAT IT DOES:
- Captures live browser screenshot via Chrome DevTools Protocol (CDP)
- Fetches corresponding frame image from Figma
- Compares pixel-by-pixel with configurable threshold
- Returns PASS/FAIL status with match score, problematic regions, and recommendations

REQUIREMENTS:
- Chrome running with --remote-debugging-port (default: 9222)
- URL must be accessible from your machine
- Figma node/frame must exist and be visible

NODE ID FORMATS:
- URL format: '123-456' (from Figma URL)
- API format: '123:456' (accepts both, auto-converts)
- Alternative: page_name + figma_frame_name for frame lookup

VIEWPORT:
- Optional if frame has absoluteBoundingBox (auto-detected from Figma)
- Required if frame dimensions unknown
- Must match actual browser viewport for accurate comparison

RETURN VALUES:
- PASS: match_score >= pass_threshold (default 90%)
- FAIL: match_score < pass_threshold, includes problematic_regions (9-grid) and recommendations
- ERROR: Chrome unavailable, frame not found, or image comparison failed

USAGE TIPS:
1. Call get_frame_info first to verify frame exists and get dimensions
2. Use figma_node_id for fastest access (no page/frame name searching)
3. For responsive testing, call with different viewport sizes
4. Adjust threshold (0-1) for stricter/looser pixel comparison

RETURN STRUCTURE:
Results are automatically organized by visual sections (detected by background color):
- status: PASS | FAIL | PARTIAL
- overall_score: averaged match_score across all sections (0-100)
- sections[]: array of detected visual sections, each containing:
  * id: section identifier
  * name: descriptive section name
  * status: section-level validation status
  * match_score: pixel-perfect match percentage for this section
  * bounds: {x, y, width, height} coordinates
  * bgColor: section background color
  * css_tree: hierarchical CSS structure of elements in section
  * problems[]: list of detected mismatches
  * recommendations[]: suggestions to fix issues
- dependencies[]: elements that cross multiple sections
- implementation_order[]: suggested build sequence for sections
- legend: field explanations and color codes`;

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL (e.g., "h75vgHNcwxfHkRBbI53RRu")'),
  url: z.string().describe('URL to validate (e.g., http://localhost:3000)'),
  figma_node_id: z.string()
    .optional()
    .describe('Figma node ID (format: "123:456" or "123-456"). Preferred - fastest method.'),
  page_name: z.string()
    .optional()
    .describe('Page name for frame lookup (partial match, case-insensitive). Use with figma_frame_name.'),
  figma_frame_name: z.string()
    .optional()
    .describe('Frame name for lookup (partial match, case-insensitive). Use with page_name.'),
  viewport: z.object({
    width: z.number().describe('Viewport width'),
    height: z.number().optional().describe('Viewport height')
  })
    .optional()
    .describe('Viewport dimensions (width required, height optional). If omitted, auto-detected from Figma frame.'),
  cdp_port: z.number()
    .default(DEFAULT_CDP_PORT)
    .describe('Chrome DevTools Protocol port (default: 9222)'),
  threshold: z.number()
    .default(0.1)
    .describe('Pixel difference threshold 0-1 (default: 0.1, lower = stricter)'),
  pass_threshold: z.number()
    .default(90)
    .describe('Match percentage to pass (default: 90)')
};

function generateRecommendations(regions) {
  const recommendations = [];

  const hasCritical = regions.some(r => r.severity === 'critical');
  const hasModerate = regions.some(r => r.severity === 'moderate');

  if (hasCritical) {
    recommendations.push("Check for missing elements in critical regions");
    recommendations.push("Verify all images and icons are loading");
  }

  if (hasModerate) {
    recommendations.push("Check font family and weight");
    recommendations.push("Verify exact hex colors from Figma");
    recommendations.push("Check spacing and padding values");
  }

  for (const region of regions.slice(0, 3)) {
    recommendations.push(`Check ${region.area}: ${region.possibleCause}`);
  }

  return [...new Set(recommendations)];
}

async function validateChunked(params, figmaClient, figmaNode, viewport) {
  const { file_key, url, cdp_port = DEFAULT_CDP_PORT, figma_node_id, threshold, pass_threshold } = params;

  try {
    const grid = calculateChunkGrid(viewport.width, viewport.height, DEFAULT_CHUNK_SIZE);

    const figmaImageData = await figmaClient.getImage(file_key, figma_node_id, 'png', 1);
    const figmaImageUrl = figmaImageData.images[Object.keys(figmaImageData.images)[0]];

    if (!figmaImageUrl) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "ERROR",
            error: "Figma API não retornou URL da imagem",
            hint: "Verifique se o node_id está correto e tem permissão de exportação"
          }, null, 2)
        }]
      };
    }

    let figmaFullImage = null;
    const chunkResults = [];

    for (const chunk of grid.chunks) {
      try {
        const figmaChunkResult = await extractFigmaChunk(figmaImageUrl, chunk, figmaFullImage);
        figmaFullImage = figmaChunkResult.fullImage;
        const figmaChunkBuffer = figmaChunkResult.buffer;

        const browserResult = await captureScreenshotRegion(url, chunk, viewport, cdp_port);
        if (!browserResult.success) {
          chunkResults.push({
            ...chunk,
            matchScore: 0,
            error: browserResult.error
          });
          continue;
        }

        const browserChunkBuffer = Buffer.from(browserResult.data, 'base64');

        const comparison = await compareImages(
          figmaChunkBuffer,
          browserChunkBuffer,
          { threshold, includeDiffImage: true }
        );

        if (!comparison.success) {
          chunkResults.push({
            ...chunk,
            matchScore: 0,
            error: comparison.error
          });
          continue;
        }

        const matchScore = comparison.matchScore;

        let diffThumbnail = null;
        if (matchScore < pass_threshold && comparison.diffImageBase64) {
          diffThumbnail = await generateDiffThumbnail(comparison.diffImageBase64);
        }

        chunkResults.push({
          ...chunk,
          matchScore,
          diffThumbnail,
          mismatchPercentage: 100 - matchScore
        });

      } catch (error) {
        chunkResults.push({
          ...chunk,
          matchScore: 0,
          error: error.message
        });
      }
    }

    figmaFullImage = null;

    const consolidated = consolidateChunkResults(chunkResults, pass_threshold);
    const gridMap = generateGridMap(chunkResults, grid.columns, grid.rows, pass_threshold);
    const recommendations = generateChunkedRecommendations(consolidated.problemAreas, grid.columns, grid.rows);

    const passed = consolidated.overallScore >= pass_threshold;

    const result = {
      status: passed ? 'PASS' : 'FAIL',
      match_score: Math.round(consolidated.overallScore * 10) / 10,
      pass_threshold,
      viewport,
      figma_node_id,

      chunking: {
        enabled: true,
        reason: 'frame_exceeds_4096px',
        frame_size: { width: viewport.width, height: viewport.height },
        chunk_size: { width: DEFAULT_CHUNK_SIZE, height: DEFAULT_CHUNK_SIZE },
        grid: { columns: grid.columns, rows: grid.rows },
        total_chunks: grid.chunks.length,
        processed_chunks: chunkResults.filter(c => !c.error).length,
        failed_chunks: consolidated.failedChunks
      },

      grid_map: gridMap,

      problem_areas: consolidated.problemAreas.map(p => ({
        chunk_id: p.id,
        position: { x: p.x, y: p.y },
        size: { width: p.width, height: p.height },
        match_score: Math.round(p.matchScore * 10) / 10,
        diff_thumbnail: p.diffThumbnail ? `data:image/png;base64,${p.diffThumbnail}` : null
      })),

      summary: passed
        ? `Visual match ${consolidated.overallScore.toFixed(1)}% across ${grid.chunks.length} chunks - PASSED`
        : `Visual match ${consolidated.overallScore.toFixed(1)}% (need ${pass_threshold}%) across ${grid.chunks.length} chunks. ${consolidated.problemAreas.length} problem area(s).`,

      recommendations
    };

    if (!passed) {
      result.next_action = "Corrija as diferenças listadas nos problem_areas e chame validate_implementation novamente";
    } else {
      result.next_action = "Validação OK. Prossiga para próximo elemento.";
    }

    const content = [{ type: "text", text: JSON.stringify(result, null, 2) }];

    for (const area of consolidated.problemAreas.slice(0, 6)) {
      if (area.diffThumbnail) {
        content.push({
          type: "image",
          data: area.diffThumbnail,
          mimeType: "image/png"
        });
      }
    }

    return { content };

  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "CHUNKED_VALIDATION_ERROR",
          error: error.message,
          hint: "Erro durante validação chunked. Verifique se chunkedValidation.js está configurado corretamente"
        }, null, 2)
      }]
    };
  }
}

async function organizeBySections(
  figmaClient,
  figmaImageBuffer,
  browserImageBuffer,
  globalComparison,
  figmaNode,
  actualViewport,
  file_key,
  pass_threshold,
  chunker
) {
  try {
    const frameChildren = figmaNode.children || [];
    const sectionGroups = groupNodesBySection(frameChildren);
    const transitionElements = findTransitionElements(sectionGroups, frameChildren);

    const frameOffsetY = figmaNode.absoluteBoundingBox?.y || 0;

    const sections = sectionGroups.map((sectionGroup, idx) => {
      const firstNode = sectionGroup.nodes[0];
      const sectionBounds = {
        x: 0,
        y: Math.round(sectionGroup.minY - frameOffsetY),
        width: Math.round(figmaNode.absoluteBoundingBox?.width || actualViewport.width),
        height: Math.round(sectionGroup.maxY - sectionGroup.minY)
      };

      return {
        id: `section-${idx}`,
        name: firstNode.name || `Section ${idx + 1}`,
        bounds: sectionBounds,
        bgColor: sectionGroup.bgColor || '#FFFFFF',
        figmaNodes: sectionGroup.nodes,
        nodeGroup: sectionGroup
      };
    });

    const sectionResults = [];
    let totalMatch = 0;
    let failedCount = 0;

    for (const section of sections) {
      try {
        const figmaChunk = await sharp(figmaImageBuffer)
          .extract({
            left: Math.round(section.bounds.x),
            top: Math.round(section.bounds.y),
            width: Math.round(section.bounds.width),
            height: Math.round(section.bounds.height)
          })
          .toBuffer();

        const browserChunk = await sharp(browserImageBuffer)
          .extract({
            left: Math.round(section.bounds.x),
            top: Math.round(section.bounds.y),
            width: Math.round(section.bounds.width),
            height: Math.round(section.bounds.height)
          })
          .toBuffer();

        const comparison = await compareImages(figmaChunk, browserChunk, {
          threshold: 0.1,
          includeDiffImage: true
        });

        if (!comparison.success) {
          sectionResults.push({
            id: section.id,
            name: section.name,
            status: 'ERROR',
            match_score: 0,
            bounds: section.bounds,
            bgColor: section.bgColor,
            error: comparison.error,
            problems: [],
            css_tree: null,
            recommendations: []
          });
          failedCount++;
          continue;
        }

        const status = determineSectionStatus(comparison.matchScore, pass_threshold);
        const problems = analyzeSectionProblems(comparison.regions, section);
        const cssTree = section.figmaNodes.length > 0
          ? extractCssTree(section.figmaNodes[0])
          : null;

        const recommendations = [];
        if (problems.length > 0) {
          const criticalProblems = problems.filter(p => p.severity === 'critical');
          if (criticalProblems.length > 0) {
            recommendations.push('Fix critical regions: ' + criticalProblems.map(p => p.area).join(', '));
          }
          recommendations.push('Verify CSS properties match Figma design exactly');
          recommendations.push('Check that all images and icons are loading');
        }

        sectionResults.push({
          id: section.id,
          name: section.name,
          status,
          match_score: comparison.matchScore,
          bounds: section.bounds,
          bgColor: section.bgColor,
          problems: problems.length > 0 ? problems : [],
          css_tree: cssTree,
          recommendations: recommendations.length > 0 ? recommendations : []
        });

        totalMatch += comparison.matchScore;
        if (status === 'FAIL') failedCount++;

      } catch (error) {
        sectionResults.push({
          id: section.id,
          name: section.name,
          status: 'ERROR',
          match_score: 0,
          bounds: section.bounds,
          bgColor: section.bgColor,
          error: error.message,
          problems: [],
          css_tree: null,
          recommendations: []
        });
        failedCount++;
      }
    }

    const overallScore = sectionResults.length > 0
      ? totalMatch / sectionResults.length
      : 0;

    const overallStatus = determineOverallStatus(failedCount, sectionResults.length);

    const dependencies = buildDependencyMap(transitionElements, sections);
    const implementationOrder = calculateImplementationOrder(sections, dependencies);

    const nextAction = overallStatus === 'PASS'
      ? 'All sections validated successfully. Proceed to next step.'
      : `${failedCount} section(s) need fixes. Start with section ${implementationOrder[0]?.sectionId || 'section-0'} (${implementationOrder[0]?.sectionName || 'first section'})`;

    const result = {
      status: overallStatus,
      overall_score: parseFloat(overallScore.toFixed(1)),
      pass_threshold,
      legend: buildSectionLegend(),
      sections: sectionResults,
      dependencies: dependencies.length > 0 ? dependencies : [],
      implementation_order: implementationOrder,
      next_action: nextAction,
      summary: `Validated ${sectionResults.length} sections. Overall match: ${overallScore.toFixed(1)}%. ${failedCount} section(s) below threshold.`
    };

    const wrappedResponse = chunker
      ? chunker.wrapResponse(result, {
        step: 'Section-by-section validation',
        progress: `${sectionResults.length} sections analyzed`,
        nextStep: nextAction
      })
      : result;

    return {
      content: [{ type: 'text', text: JSON.stringify(wrappedResponse, null, 2) }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ERROR',
          error: error.message,
          hint: 'Erro ao organizar validação por seções. Verifique se figmaNode contém children.'
        }, null, 2)
      }]
    };
  }
}

export async function handler(args, ctx) {
  const { figmaClient, chunker, session } = ctx;
  const {
    file_key,
    figma_frame_name,
    figma_node_id,
    page_name,
    url,
    viewport,
    cdp_port = DEFAULT_CDP_PORT,
    threshold = 0.1,
    pass_threshold = 90
  } = args;

  try {
    const chromeCheck = await checkChromeAvailable(cdp_port);
    if (!chromeCheck.available) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "CDP_UNAVAILABLE",
            error: "Chrome DevTools não disponível",
            port: cdp_port,
            hint: chromeCheck.hint,
            action: `Inicie Chrome com: google-chrome --remote-debugging-port=${cdp_port}`
          }, null, 2)
        }]
      };
    }

    let figmaNode = null;
    let resolvedNodeId = null;

    if (figma_node_id) {
      figmaNode = await figmaClient.getNodeById(file_key, figma_node_id);
      resolvedNodeId = figma_node_id;
    } else if (page_name && figma_frame_name) {
      const file = await figmaClient.getFile(file_key, 2);
      const page = figmaClient.findPageByName(file, page_name);

      if (!page) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "FIGMA_PAGE_NOT_FOUND",
              error: "Página não encontrada no Figma",
              searched: { page_name },
              hint: "Verifique o nome da página. Use list_pages para ver páginas disponíveis."
            }, null, 2)
          }]
        };
      }

      figmaNode = figmaClient.findFrameByName(page, figma_frame_name);
      if (figmaNode) {
        resolvedNodeId = figmaNode.id;
      }
    } else if (figma_frame_name) {
      const frameData = session.getCachedData(`frame_${figma_frame_name}`);
      if (frameData?.nodeId) {
        resolvedNodeId = frameData.nodeId;
        figmaNode = await figmaClient.getNodeById(file_key, resolvedNodeId);
      }
    }

    if (!resolvedNodeId || !figmaNode) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "FIGMA_NODE_NOT_FOUND",
            error: "Frame não encontrado no Figma",
            searched: { file_key, page_name, figma_frame_name, figma_node_id },
            hint: "Use get_frame_info primeiro para localizar o frame, ou passe figma_node_id diretamente"
          }, null, 2)
        }]
      };
    }

    let actualViewport = viewport;

    if (!actualViewport) {
      const extractedViewport = extractViewportFromNode(figmaNode);
      if (extractedViewport) {
        actualViewport = extractedViewport;
      }
    }

    if (!actualViewport) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "VIEWPORT_NOT_FOUND",
            error: "Viewport não fornecido e não pode ser auto-detectado",
            hint: "Forneça viewport com width e height, ou verifique se o node_id é válido e contém absoluteBoundingBox"
          }, null, 2)
        }]
      };
    }

    if (needsChunking(actualViewport.width, actualViewport.height)) {
      return await validateChunked(
        {
          file_key,
          url,
          cdp_port,
          figma_node_id: resolvedNodeId,
          threshold,
          pass_threshold
        },
        figmaClient,
        figmaNode,
        actualViewport
      );
    }

    const imageData = await figmaClient.getImage(file_key, resolvedNodeId, 'png', 1);
    const apiNodeId = convertNodeIdToApiFormat(resolvedNodeId);
    const imageUrl = imageData.images[apiNodeId];

    if (!imageUrl) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "FIGMA_IMAGE_ERROR",
            error: "Não foi possível obter imagem do Figma",
            node_id: resolvedNodeId
          }, null, 2)
        }]
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    let figmaImageBuffer;
    let lastFetchError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const figmaResponse = await fetch(imageUrl, { signal: controller.signal });
        if (!figmaResponse.ok) {
          throw new Error(`Figma API returned ${figmaResponse.status}`);
        }
        figmaImageBuffer = Buffer.from(await figmaResponse.arrayBuffer());
        break;
      } catch (error) {
        lastFetchError = error;
        if (error.name === 'AbortError') break;
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    clearTimeout(timeoutId);

    if (!figmaImageBuffer) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "FIGMA_FETCH_ERROR",
            error: `Falha ao baixar imagem do Figma após 3 tentativas: ${lastFetchError?.message}`,
            hint: "Verifique conexão de rede ou tente novamente"
          }, null, 2)
        }]
      };
    }

    const browserCapture = await captureScreenshot(url, actualViewport, cdp_port);

    if (!browserCapture.success) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: browserCapture.error,
            error: browserCapture.message,
            hint: "Verifique se Chrome está rodando com --remote-debugging-port e a URL está acessível"
          }, null, 2)
        }]
      };
    }

    const browserImageBuffer = Buffer.from(browserCapture.data, 'base64');

    const comparison = await compareImages(figmaImageBuffer, browserImageBuffer, { threshold, includeDiffImage: true });

    if (!comparison.success) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "COMPARISON_ERROR",
            error: comparison.error,
            message: comparison.message,
            details: comparison.details,
            hint: comparison.error === "DIMENSION_MISMATCH"
              ? "Ajuste o viewport para corresponder às dimensões do frame Figma"
              : "Verifique se ambas as imagens são válidas"
          }, null, 2)
        }]
      };
    }

    const passed = comparison.matchScore >= pass_threshold;

    const hasFrameStructure = figmaNode.children && figmaNode.children.length > 0;

    if (hasFrameStructure) {
      return await organizeBySections(
        figmaClient,
        figmaImageBuffer,
        browserImageBuffer,
        comparison,
        figmaNode,
        actualViewport,
        file_key,
        pass_threshold,
        chunker
      );
    }

    const result = {
      status: passed ? "PASS" : "FAIL",
      match_score: comparison.matchScore,
      pass_threshold,
      viewport: actualViewport,
      figma_node_id: resolvedNodeId,
      dimensions: comparison.dimensions,
      mismatched_pixels: comparison.mismatchedPixels,
      problematic_regions: comparison.regions,
      summary: passed
        ? `Visual match ${comparison.matchScore}% - PASSED`
        : `Visual match ${comparison.matchScore}% (need ${pass_threshold}%). ${comparison.regions.length} problematic region(s).`
    };

    if (!passed) {
      result.recommendations = generateRecommendations(comparison.regions);
      result.next_action = "Corrija as diferenças listadas e chame validate_implementation novamente";
      if (comparison.diffImageBase64) {
        result.diff_image = {
          available: true,
          description: "Visual diff - red/magenta areas show mismatches (included as separate image content)"
        };
      }
    } else {
      result.next_action = "Validação OK. Prossiga para próximo elemento.";
    }

    const content = [{ type: "text", text: JSON.stringify(result, null, 2) }];

    if (!passed && comparison.diffImageBase64) {
      content.push({
        type: "image",
        data: comparison.diffImageBase64,
        mimeType: "image/png"
      });
    }

    return { content };

  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "ERROR",
          error: error.message,
          hint: "Verifique file_key, node_id e se Chrome está acessível"
        }, null, 2)
      }]
    };
  }
}
