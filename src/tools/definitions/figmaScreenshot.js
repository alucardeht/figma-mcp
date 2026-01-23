import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import { resolveTarget } from '../../utils/index.js';
import { convertNodeIdToApiFormat } from '../../utils/nodeId.js';
import { groupNodesBySection, inferSectionName } from './sectionHelpers.js';

export const name = 'figma_screenshot';

export const description =
  'Unified screenshot capture for any Figma target. Supports fuzzy search (page+frame), direct node access, nested element selection, section cropping, tiling for large images, and disk export.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  node_id: z
    .string()
    .optional()
    .describe('Figma node ID (format: 40000056-28165) - fastest access'),
  page_name: z.string().optional().describe('Page name (partial match)'),
  frame_name: z.string().optional().describe('Frame name (partial match)'),
  query: z.string().optional().describe('Fuzzy search query'),
  element_name: z
    .string()
    .optional()
    .describe('Nested element name to screenshot (deep search within resolved frame)'),
  section_id: z
    .string()
    .optional()
    .describe('Section ID from analyze_page_structure (e.g., section-0)'),
  scale: z
    .number()
    .min(1)
    .max(4)
    .default(2)
    .describe('Image scale 1-4 (default: 2)'),
  format: z
    .enum(['png', 'jpg', 'webp'])
    .default('png')
    .describe('Image format (default: png)'),
  quality: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe('JPEG/WebP quality 1-100'),
  max_dimension: z
    .number()
    .default(4096)
    .describe('Max px before segmenting (default: 4096)'),
  include_transition_context: z
    .boolean()
    .default(true)
    .describe('Include margin context for section transitions (default: true)'),
  save_to_file: z
    .string()
    .optional()
    .describe('Path to save image instead of returning base64'),
};

async function segmentImage(buffer, options) {
  const { width, height, maxDimension = 4096, format = 'png', quality } = options;

  const image = sharp(buffer);
  const metadata = await image.metadata();

  const cols = Math.ceil(metadata.width / maxDimension);
  const rows = Math.ceil(metadata.height / maxDimension);
  const tileWidth = Math.ceil(metadata.width / cols);
  const tileHeight = Math.ceil(metadata.height / rows);

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = col * tileWidth;
      const top = row * tileHeight;
      const extractWidth = Math.min(tileWidth, metadata.width - left);
      const extractHeight = Math.min(tileHeight, metadata.height - top);

      let tile = sharp(buffer).extract({
        left,
        top,
        width: extractWidth,
        height: extractHeight,
      });

      if (format === 'jpg') {
        tile = tile.jpeg({ quality: quality || 85 });
      } else if (format === 'webp') {
        tile = tile.webp({ quality: quality || 85 });
      } else {
        tile = tile.png();
      }

      const tileBuffer = await tile.toBuffer();

      tiles.push({
        row,
        col,
        data: tileBuffer.toString('base64'),
      });
    }
  }

  return tiles;
}

function getSectionsFromFrame(frame) {
  const children = frame.children || [];
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;

  const sectionGroups = groupNodesBySection(children);

  if (sectionGroups.length === 0) {
    return [{
      id: 'section-0',
      name: frame.name,
      bounds: {
        x: 0,
        y: 0,
        width: frame.absoluteBoundingBox?.width || 0,
        height: frame.absoluteBoundingBox?.height || 0,
      },
      backgroundColor: extractBackgroundColor(frame),
      childCount: children.length,
    }];
  }

  return sectionGroups.map((group, idx) => {
    const firstNode = group.nodes[0];
    const sectionName = inferSectionName(firstNode.name) || firstNode.name;

    return {
      id: `section-${idx}`,
      name: sectionName,
      bounds: {
        x: 0,
        y: Math.round(group.minY - frameOffsetY),
        width: frame.absoluteBoundingBox?.width || 0,
        height: Math.round(group.maxY - group.minY),
      },
      backgroundColor: group.bgColor || 'transparent',
      childCount: group.nodes.length,
    };
  });
}

function extractBackgroundColor(node) {
  if (!node.fills || node.fills.length === 0) return 'transparent';

  const fill = node.fills.find((f) => f.visible !== false);
  if (!fill || !fill.color) return 'transparent';

  const { r, g, b, a } = fill.color;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${a || 1})`;
}

async function formatImageBuffer(buffer, format, quality) {
  let image = sharp(buffer);

  if (format === 'jpg') {
    return image.jpeg({ quality: quality || 85 }).toBuffer();
  } else if (format === 'webp') {
    return image.webp({ quality: quality || 85 }).toBuffer();
  } else {
    return image.png().toBuffer();
  }
}

export async function handler(args, ctx) {
  const {
    file_key: fileKey,
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    query,
    element_name: elementName,
    section_id: sectionId,
    scale = 2,
    format = 'png',
    quality,
    max_dimension: maxDimension = 4096,
    include_transition_context: includeTransitionContext = true,
    save_to_file: saveToFile,
  } = args;

  const { chunker, figmaClient, session } = ctx;

  session.setCurrentFile(fileKey);

  if (!nodeId && !pageName && !frameName && !query) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: 'Must provide node_id OR (page_name + frame_name) OR query',
              errorType: 'invalid_parameters',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const fetchDepth = elementName ? 10 : 3;
  const file = await figmaClient.getFile(fileKey, fetchDepth);

  const resolution = resolveTarget(file, {
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    query,
    element_name: elementName,
  });

  if (!resolution.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: resolution.error,
              errorType: resolution.errorType,
              suggestions: resolution.suggestions,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  let targetFrame = null;
  let frameName_ = null;

  if (resolution.type === 'page' && !sectionId) {
    const page = file.document.children.find((p) => p.id === resolution.target.id);
    if (!page || !page.children || page.children.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { error: 'Page has no frames to screenshot' },
              null,
              2
            ),
          },
        ],
      };
    }
    targetFrame = page.children.find(
      (c) => c.type === 'FRAME' || c.type === 'COMPONENT'
    ) || page.children[0];
    frameName_ = targetFrame.name;
  } else if (resolution.type === 'frame') {
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
      targetFrame = findNode(page, resolution.target.id);
      frameName_ = targetFrame?.name || resolution.target.id;
    }
  } else if (resolution.type === 'node') {
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
      targetFrame = findNode(page, resolution.target.id);
      frameName_ = targetFrame?.name || resolution.target.id;
    }
  } else if (resolution.type === 'element') {
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
      targetFrame = findNode(page, resolution.target.id);
      frameName_ = targetFrame?.name || resolution.target.id;
    }
  }

  if (!targetFrame) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { error: 'Target frame not found after resolution', errorType: 'not_found' },
            null,
            2
          ),
        },
      ],
    };
  }

  const frameWidth = (targetFrame.absoluteBoundingBox?.width || 0) * scale;
  const frameHeight = (targetFrame.absoluteBoundingBox?.height || 0) * scale;

  const imageData = await figmaClient.getImage(
    fileKey,
    targetFrame.id,
    'png',
    scale
  );

  const imageUrl = imageData.images[targetFrame.id];
  if (!imageUrl) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: 'Failed to generate image' }, null, 2),
        },
      ],
    };
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
  });
  let imageBuffer = Buffer.from(imageResponse.data);

  let sectionInfo = null;
  let bounds = null;

  if (sectionId) {
    const sections = getSectionsFromFrame(targetFrame);
    const section = sections.find((s) => s.id === sectionId);

    if (!section) {
      const availableIds = sections.map((s) => s.id).join(', ');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: `Section "${sectionId}" not found`,
                available: availableIds,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    bounds = {
      x: Math.round(section.bounds.x * scale),
      y: Math.round(section.bounds.y * scale),
      width: Math.round(section.bounds.width * scale),
      height: Math.round(section.bounds.height * scale),
    };

    if (includeTransitionContext) {
      const margin = 20;
      bounds.x = Math.max(0, bounds.x - margin);
      bounds.y = Math.max(0, bounds.y - margin);
      bounds.width = Math.min(frameWidth - bounds.x, bounds.width + margin * 2);
      bounds.height = Math.min(
        frameHeight - bounds.y,
        bounds.height + margin * 2
      );
    }

    imageBuffer = await sharp(imageBuffer)
      .extract({
        left: Math.round(bounds.x),
        top: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
      .png()
      .toBuffer();

    sectionInfo = {
      sectionId: section.id,
      sectionName: section.name,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
    };
  }

  let formattedBuffer = imageBuffer;
  if (format !== 'png') {
    formattedBuffer = await formatImageBuffer(imageBuffer, format, quality);
  }

  if (saveToFile) {
    await fs.writeFile(saveToFile, formattedBuffer);

    const responseData = {
      frame: frameName_,
      format,
      savedTo: saveToFile,
      size: formattedBuffer.length,
      ...(sectionInfo && { section: sectionInfo }),
    };

    const navInfo = chunker.wrapResponse(responseData, {
      step: 'Screenshot saved to disk',
      progress: 'Complete',
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(navInfo, null, 2) }],
    };
  }

  const finalWidth = bounds ? bounds.width : frameWidth;
  const finalHeight = bounds ? bounds.height : frameHeight;

  if (finalWidth > maxDimension || finalHeight > maxDimension) {
    const tiles = await segmentImage(formattedBuffer, {
      width: finalWidth,
      height: finalHeight,
      maxDimension,
      format,
      quality,
    });

    const responseData = {
      frame: frameName_,
      format,
      width: Math.round(finalWidth),
      height: Math.round(finalHeight),
      tiles: tiles.length,
      ...(sectionInfo && { section: sectionInfo }),
    };

    const navInfo = chunker.wrapResponse(responseData, {
      step: `Screenshot segmented into ${tiles.length} tiles`,
      progress: 'Complete',
    });

    return {
      content: [
        { type: 'text', text: JSON.stringify(navInfo, null, 2) },
        ...tiles.map((tile) => ({
          type: 'image',
          data: tile.data,
          mimeType: `image/${format}`,
        })),
      ],
    };
  }

  const responseData = {
    frame: frameName_,
    format,
    width: Math.round(finalWidth),
    height: Math.round(finalHeight),
    ...(sectionInfo && { section: sectionInfo }),
  };

  const navInfo = chunker.wrapResponse(responseData, {
    step: 'Screenshot captured',
    progress: 'Complete',
  });

  return {
    content: [
      { type: 'text', text: JSON.stringify(navInfo, null, 2) },
      {
        type: 'image',
        data: formattedBuffer.toString('base64'),
        mimeType: `image/${format}`,
      },
    ],
  };
}
