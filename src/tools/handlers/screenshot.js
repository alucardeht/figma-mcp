import axios from "axios";
import sharp from "sharp";

export async function getScreenshot(ctx, fileKey, pageName, frameName, scale, maxDimension) {
  const { chunker, figmaClient } = ctx;

  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);
  if (!page) throw new Error(`Page "${pageName}" not found`);

  const frame = figmaClient.findFrameByName(page, frameName);
  if (!frame) throw new Error(`Frame "${frameName}" not found`);

  const width = (frame.absoluteBoundingBox?.width || 0) * scale;
  const height = (frame.absoluteBoundingBox?.height || 0) * scale;

  const imageData = await figmaClient.getImage(fileKey, frame.id, "png", scale);

  const imageUrl = imageData.images[frame.id];
  if (!imageUrl) throw new Error("Failed to generate image");

  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

  if (width > maxDimension || height > maxDimension) {
    const tiles = await segmentImage(response.data, width, height, maxDimension);

    const navInfo = chunker.wrapResponse(
      { frame: frame.name, width: Math.round(width), height: Math.round(height), tiles: tiles.length },
      {
        step: `Screenshot segmented into ${tiles.length} tiles`,
        progress: "Complete",
        nextStep: "Use get_frame_info for structure details",
      }
    );

    return {
      content: [
        { type: "text", text: JSON.stringify(navInfo, null, 2) },
        ...tiles.map((tile) => ({
          type: "image",
          data: tile.data,
          mimeType: "image/png",
        })),
      ],
    };
  }

  const navInfo = chunker.wrapResponse(
    { frame: frame.name, width: Math.round(width), height: Math.round(height) },
    {
      step: "Screenshot captured",
      progress: "Complete",
      nextStep: "Use get_frame_info for structure, or extract_assets for icons/images",
    }
  );

  return {
    content: [
      { type: "text", text: JSON.stringify(navInfo, null, 2) },
      {
        type: "image",
        data: Buffer.from(response.data).toString("base64"),
        mimeType: "image/png",
      },
    ],
  };
}

async function segmentImage(buffer, width, height, maxDimension) {
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

      const tile = await sharp(buffer)
        .extract({ left, top, width: extractWidth, height: extractHeight })
        .png()
        .toBuffer();

      tiles.push({
        row,
        col,
        data: tile.toString("base64"),
      });
    }
  }

  return tiles;
}
