import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import { resolveTarget } from '../../utils/index.js';
import {
  SECTION_KEYWORDS,
  inferSectionName,
  getBackgroundColor,
  groupNodesBySection,
  findTransitionElements,
  extractSectionAssets,
  extractSectionStyles,
  countAssetsOnly,
  buildAgentInstructions,
  extractCssTree,
} from './sectionHelpers.js';

export const name = 'figma_context';

export const description =
  'Universal Figma context retrieval - "magic tool" that returns EVERYTHING an agent needs to implement. Supports 3 modes: frame context (overview), section context (detailed), and pages list. Intelligent target resolution with flexible data inclusion.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  target: z.string().optional().describe('Fuzzy search target: page name, frame name, or query'),
  node_id: z.string().optional().describe('Direct Figma node ID (fastest, overrides fuzzy search)'),
  page_name: z.string().optional().describe('Page name (partial match)'),
  frame_name: z.string().optional().describe('Frame name (partial match)'),
  section_id: z.string().optional().describe('Section ID for detailed context (e.g., "section-0")'),
  include: z
    .array(z.enum(['structure', 'styles', 'assets', 'screenshots', 'css_tree', 'instructions', 'asset_map']))
    .optional()
    .describe('What to include in response (default: structure, styles)')
    .default(['structure', 'styles']),
  scale: z.number().optional().describe('Screenshot scale 1-4 (default: 2)').default(2),
  depth: z.number().optional().describe('CSS tree depth 1-5 (default: 3)').default(3),
  agent_index: z.number().optional().describe('Zero-based agent index for instructions').default(0),
  total_agents: z.number().optional().describe('Total agents for parallel work').default(1),
};

async function captureFullFrameImage(ctx, fileKey, frame, scale = 2) {
  const { figmaClient } = ctx;

  try {
    const imageData = await figmaClient.getImage(fileKey, frame.id, 'png', scale);
    const imageUrl = imageData.images[frame.id];

    if (!imageUrl) return null;

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Failed to capture frame image:', error.message);
    return null;
  }
}

async function extractSectionScreenshot(frameImageBuffer, sectionBounds, scale = 2) {
  if (!frameImageBuffer) return null;

  try {
    const bounds = {
      x: Math.round(sectionBounds.x * scale),
      y: Math.round(sectionBounds.y * scale),
      width: Math.round(sectionBounds.width * scale),
      height: Math.round(sectionBounds.height * scale),
    };

    const croppedImage = await sharp(frameImageBuffer)
      .extract({
        left: Math.max(0, bounds.x),
        top: Math.max(0, bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
      .png()
      .toBuffer();

    return croppedImage.toString('base64');
  } catch (error) {
    console.error('Failed to extract section screenshot:', error.message);
    return null;
  }
}

function buildAssetMap(sections) {
  const assetMap = {};

  for (const section of sections) {
    if (section.assets) {
      for (const icon of section.assets.icons) {
        assetMap[icon.uniqueName] = {
          sectionId: section.id,
          type: 'icon',
          exportUrl: icon.exportUrl,
        };
      }

      for (const image of section.assets.images) {
        assetMap[image.uniqueName] = {
          sectionId: section.id,
          type: 'image',
          exportUrl: image.exportUrl,
        };
      }
    }
  }

  return assetMap;
}

function countTotalAssets(sections) {
  let icons = 0;
  let images = 0;

  for (const section of sections) {
    if (section.assets) {
      icons += section.assets.icons.length;
      images += section.assets.images.length;
    } else if (section.assetCount) {
      icons += section.assetCount.icons;
      images += section.assetCount.images;
    }
  }

  return { icons, images };
}

async function buildFrameContext(ctx, fileKey, frame, include, scale, depth) {
  const frameChildren = frame.children || [];
  const sectionGroups = groupNodesBySection(frameChildren);
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;
  const includeScreenshots = include.includes('screenshots');
  const includeAssets = include.includes('assets');
  const includeStyles = include.includes('styles');
  const includeInstructions = include.includes('instructions');
  const includeCssTree = include.includes('css_tree');
  const includeAssetMap = include.includes('asset_map') && includeAssets;

  let frameImageBuffer = null;
  if (includeScreenshots) {
    frameImageBuffer = await captureFullFrameImage(ctx, fileKey, frame, scale);
  }

  const sections = [];

  for (let idx = 0; idx < sectionGroups.length; idx++) {
    const sectionGroup = sectionGroups[idx];
    const firstNode = sectionGroup.nodes[0];
    const sectionName = inferSectionName(firstNode.name) || `Section ${idx + 1}`;

    const sectionBounds = {
      x: 0,
      y: Math.round(sectionGroup.minY - frameOffsetY),
      width: frame.absoluteBoundingBox?.width || 0,
      height: Math.round(sectionGroup.maxY - sectionGroup.minY),
    };

    const sectionNodes = [];
    for (const node of sectionGroup.nodes) {
      const collectNodes = (n) => {
        sectionNodes.push(n);
        const children = n.children || [];
        if (children.length > 0) {
          children.forEach(collectNodes);
        }
      };
      collectNodes(node);
    }

    const section = {
      id: `section-${idx}`,
      name: sectionName,
      bgColor: sectionGroup.bgColor || '#FFFFFF',
      bounds: {
        x: Math.round(sectionBounds.x),
        y: Math.round(sectionBounds.y),
        width: Math.round(sectionBounds.width),
        height: Math.round(sectionBounds.height),
      },
    };

    if (include.includes('structure')) {
      section.mainElements = sectionGroup.nodes.map((n) => ({
        name: n.name,
        type: n.type,
        childCount: countChildren(n) - 1,
      }));
    }

    if (includeStyles) {
      section.styles = extractSectionStyles(sectionNodes);
    }

    if (includeAssets) {
      section.assets = extractSectionAssets(sectionGroup.nodes, fileKey, sectionName, `section-${idx}`);
    } else {
      section.assetCount = countAssetsOnly(sectionGroup.nodes);
    }

    if (includeScreenshots && frameImageBuffer) {
      section.screenshot = await extractSectionScreenshot(frameImageBuffer, sectionBounds, scale);
    }

    if (includeCssTree) {
      section.cssTree = extractCssTree(firstNode, depth);
    }

    sections.push(section);
  }

  const transitionElements = findTransitionElements(sectionGroups, frameChildren);
  const totalAssets = countTotalAssets(sections);
  const recommendedAgentCount = Math.max(1, Math.min(sections.length, Math.ceil(sections.length / 2)));

  const overview = {
    frameName: frame.name,
    frameSize: {
      width: Math.round(frame.absoluteBoundingBox?.width || 0),
      height: Math.round(frame.absoluteBoundingBox?.height || 0),
    },
    sectionCount: sections.length,
    totalAssets,
    recommendedAgents: recommendedAgentCount,
    transitionElementCount: transitionElements.length,
  };

  const result = {
    type: 'frame_context',
    overview,
    sections,
  };

  if (transitionElements.length > 0) {
    result.transitionElements = transitionElements;
  }

  if (includeAssets && includeAssetMap) {
    result.assetMap = buildAssetMap(sections);
  }

  if (includeInstructions) {
    result.agentInstructions = sections.map((section, idx) => {
      const agentInfo = {
        index: idx,
        total: sections.length,
        isFirst: idx === 0,
        isLast: idx === sections.length - 1,
      };

      const responsibilities = {
        implements: section.mainElements ? section.mainElements.map((e) => e.name) : [],
        coordinates: transitionElements
          .filter((te) => te.spansSections.includes(`section-${idx}`))
          .map((te) => te.name),
        skips: [],
      };

      return buildAgentInstructions(
        section,
        agentInfo,
        responsibilities,
        section.assets || { icons: [], images: [] },
        section.styles || {}
      );
    });
  }

  return result;
}

async function buildSectionContext(ctx, fileKey, frame, sectionId, include, scale, depth, agentIndex, totalAgents) {
  const frameChildren = frame.children || [];
  const sectionGroups = groupNodesBySection(frameChildren);
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;

  const sectionIndex = parseInt(sectionId.split('-')[1], 10);
  if (sectionIndex < 0 || sectionIndex >= sectionGroups.length) {
    throw new Error(`Invalid section ID: ${sectionId}. Available: section-0 to section-${sectionGroups.length - 1}`);
  }

  const sectionGroup = sectionGroups[sectionIndex];
  const firstNode = sectionGroup.nodes[0];
  const sectionName = inferSectionName(firstNode.name) || `Section ${sectionIndex + 1}`;

  const sectionBounds = {
    x: 0,
    y: Math.round(sectionGroup.minY - frameOffsetY),
    width: frame.absoluteBoundingBox?.width || 0,
    height: Math.round(sectionGroup.maxY - sectionGroup.minY),
  };

  const sectionNodes = [];
  for (const node of sectionGroup.nodes) {
    const collectNodes = (n) => {
      sectionNodes.push(n);
      const children = n.children || [];
      if (children.length > 0) {
        children.forEach(collectNodes);
      }
    };
    collectNodes(node);
  }

  const section = {
    id: sectionId,
    name: sectionName,
    bgColor: sectionGroup.bgColor || '#FFFFFF',
    bounds: {
      x: Math.round(sectionBounds.x),
      y: Math.round(sectionBounds.y),
      width: Math.round(sectionBounds.width),
      height: Math.round(sectionBounds.height),
    },
  };

  if (include.includes('structure')) {
    section.mainElements = sectionGroup.nodes.map((n) => ({
      name: n.name,
      type: n.type,
      childCount: countChildren(n) - 1,
    }));
  }

  if (include.includes('styles')) {
    section.styles = extractSectionStyles(sectionNodes);
  }

  if (include.includes('assets')) {
    section.assets = extractSectionAssets(sectionGroup.nodes, fileKey, sectionName, sectionId);
  } else {
    section.assetCount = countAssetsOnly(sectionGroup.nodes);
  }

  if (include.includes('screenshots')) {
    const frameImageBuffer = await captureFullFrameImage(ctx, fileKey, frame, scale);
    if (frameImageBuffer) {
      section.screenshot = await extractSectionScreenshot(frameImageBuffer, sectionBounds, scale);
    }
  }

  if (include.includes('css_tree')) {
    section.cssTree = extractCssTree(firstNode, depth);
  }

  const result = {
    type: 'section_context',
    section,
  };

  if (include.includes('instructions')) {
    const transitionElements = findTransitionElements(sectionGroups, frameChildren);

    const agentInfo = {
      index: agentIndex,
      total: totalAgents,
      isFirst: agentIndex === 0,
      isLast: agentIndex === totalAgents - 1,
    };

    const responsibilities = {
      implements: section.mainElements ? section.mainElements.map((e) => e.name) : [],
      coordinates: transitionElements
        .filter((te) => te.spansSections.includes(sectionId))
        .map((te) => te.name),
      skips: [],
    };

    for (let i = 0; i < sectionGroups.length; i++) {
      if (i !== sectionIndex) {
        responsibilities.skips.push(...sectionGroups[i].nodes.map((n) => n.name));
      }
    }

    result.instructions = buildAgentInstructions(
      section,
      agentInfo,
      responsibilities,
      section.assets || { icons: [], images: [] },
      section.styles || {}
    );

    if (transitionElements.length > 0) {
      result.transitionElements = transitionElements.filter((te) => te.spansSections.includes(sectionId));
    }
  }

  return result;
}

function countChildren(node) {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countChildren(child);
    }
  }
  return count;
}

export async function handler(args, ctx) {
  const {
    file_key: fileKey,
    target,
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    section_id: sectionId,
    include,
    scale,
    depth,
    agent_index: agentIndex,
    total_agents: totalAgents,
  } = args;

  const { session, chunker, figmaClient } = ctx;

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 3);

  if (!nodeId && !pageName && !frameName && !target && !sectionId) {
    const pages = file.document.children.map((page) => {
      session.markPageExplored(page.id);
      return {
        name: page.name,
        id: page.id,
        frameCount: page.children?.filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT').length || 0,
      };
    });

    const chunked = chunker.chunkArray(pages, `figma_context:${fileKey}`, 20);

    if (chunked) {
      const response = chunker.wrapResponse(
        {
          type: 'pages_list',
          file: file.name,
          pages: chunked.items,
        },
        {
          step: `Showing pages 1-${chunked.items.length} of ${chunked.totalItems}`,
          progress: `1/${chunked.totalChunks}`,
          nextStep: chunked.totalChunks > 1 ? 'Call with continue=true for more pages' : 'Specify a frame_name to drill down',
          operationId: `figma_context:${fileKey}`,
        }
      );
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }

    const response = chunker.wrapResponse(
      {
        type: 'pages_list',
        file: file.name,
        pages,
      },
      {
        step: `Listed all ${pages.length} pages`,
        nextStep: pages.length > 0 ? 'Use frame_name or target parameter to explore' : 'No pages found in file',
      }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  const resolution = resolveTarget(file, {
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    query: target || frameName,
  });

  if (!resolution.success) {
    const errorResponse = {
      error: resolution.error,
      errorType: resolution.errorType,
      suggestions: resolution.suggestions,
      candidates: resolution.candidates,
    };

    return { content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }] };
  }

  let frame = null;

  if (resolution.type === 'frame' || resolution.type === 'node') {
    const page = file.document.children.find((p) => p.id === resolution.page.id);
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
      frame = findNode(page, resolution.target.id);
    }
  }

  if (!frame) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'Frame not found',
              errorType: 'not_found',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  let result;

  if (sectionId) {
    result = await buildSectionContext(ctx, fileKey, frame, sectionId, include, scale, depth, agentIndex, totalAgents);
  } else {
    result = await buildFrameContext(ctx, fileKey, frame, include, scale, depth);
  }

  const response = chunker.wrapResponse(result, {
    step: sectionId ? `Prepared detailed context for ${result.section.name}` : `Prepared frame context with ${result.overview.sectionCount} sections`,
    progress: include.join(', '),
    nextStep: sectionId ? 'Agent ready to implement' : `Distribute to ${result.overview.recommendedAgents} agent(s) or request section context with section_id`,
  });

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
