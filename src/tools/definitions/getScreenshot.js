import { z } from 'zod';
import axios from 'axios';
import { convertNodeIdToApiFormat } from '../../utils/nodeId.js';

export const name = 'get_screenshot';

export const description = 'Capture frame screenshot. WARNING: Call get_frame_info FIRST. Returns base64 image(s). Use node_id for fast access OR page_name+frame_name. Scale 1-4 controls resolution.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
  page_name: z.string().optional().describe('Page name (partial match). Use with frame_name or provide node_id instead.'),
  frame_name: z.string().optional().describe('Frame name (partial match). Use with page_name or provide node_id instead.'),
  node_id: z.string().optional().describe('Figma node ID from URL (format: 40000056-28165). Alternative to page_name+frame_name - provides direct fast capture.'),
  scale: z.number().default(2).describe('Scale 1-4 (default: 2)'),
  max_dimension: z.number().default(4096).describe('Max px before segmenting (default: 4096)'),
};

async function segmentImage(buffer, options) {
  const { width, height, maxDimension = 4096, transparencyRegions = [], mode = 'tiles' } = options;
  const sharp = (await import('sharp')).default;

  let processedBuffer = buffer;
  if (transparencyRegions.length > 0) {
    processedBuffer = await applyTransparency(buffer, transparencyRegions, height);
  }

  const image = sharp(processedBuffer);
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

      const tile = await sharp(processedBuffer)
        .extract({ left, top, width: extractWidth, height: extractHeight })
        .png()
        .toBuffer();

      tiles.push({
        row,
        col,
        data: tile.toString('base64'),
      });
    }
  }

  return tiles;
}

async function applyTransparency(buffer, regions, imageHeight) {
  if (!regions || regions.length === 0) return buffer;

  const sharp = (await import('sharp')).default;
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  let maskBuffer = Buffer.alloc(width * height, 255);

  for (const region of regions) {
    const yStart = Math.max(0, Math.round(region.y_start));
    const yEnd = Math.min(height, Math.round(region.y_end));

    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        maskBuffer[y * width + x] = 0;
      }
    }
  }

  const mask = sharp(maskBuffer, {
    raw: { width, height, channels: 1 },
  });

  return image.ensureAlpha().composite([
    {
      input: await mask.toBuffer(),
      blend: 'dest-out',
    },
  ]).png().toBuffer();
}

export async function handler(args, ctx) {
  const { chunker, figmaClient } = ctx;
  const { file_key: fileKey, page_name: pageName, frame_name: frameName, scale, max_dimension: maxDimension, node_id: nodeId } = args;

  if (!nodeId && (!pageName || !frameName)) {
    throw new Error('Must provide either node_id OR both page_name and frame_name');
  }

  let frameId;
  let frameNodeData;
  let frameName_;

  if (nodeId) {
    const apiNodeId = convertNodeIdToApiFormat(nodeId);
    frameId = apiNodeId;
    frameNodeData = await figmaClient.getNodeById(fileKey, nodeId);
    frameName_ = frameNodeData?.name || nodeId;
  } else {
    const file = await figmaClient.getFile(fileKey, 2);
    const page = figmaClient.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frame = figmaClient.findFrameByName(page, frameName);
    if (!frame) throw new Error(`Frame "${frameName}" not found`);

    frameId = frame.id;
    frameNodeData = frame;
    frameName_ = frame.name;
  }

  const width = (frameNodeData.absoluteBoundingBox?.width || 0) * scale;
  const height = (frameNodeData.absoluteBoundingBox?.height || 0) * scale;

  const imageData = await figmaClient.getImage(fileKey, frameId, 'png', scale);
  const imageUrl = imageData.images[frameId];
  if (!imageUrl) throw new Error('Failed to generate image');

  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

  if (width > maxDimension || height > maxDimension) {
    const tiles = await segmentImage(response.data, {
      width,
      height,
      maxDimension,
    });

    const navInfo = chunker.wrapResponse(
      { frame: frameName_, width: Math.round(width), height: Math.round(height), tiles: tiles.length },
      {
        step: `Screenshot segmented into ${tiles.length} tiles`,
        progress: 'Complete',
        nextStep: 'Use get_frame_info for structure details',
      }
    );

    return {
      content: [
        { type: 'text', text: JSON.stringify(navInfo, null, 2) },
        ...tiles.map((tile) => ({
          type: 'image',
          data: tile.data,
          mimeType: 'image/png',
        })),
      ],
    };
  }

  const navInfo = chunker.wrapResponse(
    { frame: frameName_, width: Math.round(width), height: Math.round(height) },
    {
      step: 'Screenshot captured',
      progress: 'Complete',
      nextStep: 'Use get_frame_info for structure, or extract_assets for icons/images',
    }
  );

  return {
    content: [
      { type: 'text', text: JSON.stringify(navInfo, null, 2) },
      {
        type: 'image',
        data: Buffer.from(response.data).toString('base64'),
        mimeType: 'image/png',
      },
    ],
  };
}
