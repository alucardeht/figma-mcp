import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { findAssets } from "../../utils/index.js";

export async function extractAssets(ctx, fileKey, pageName, frameName, outputDir) {
  const { chunker, figmaClient } = ctx;

  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);
  if (!page) throw new Error(`Page "${pageName}" not found`);

  const frameRef = figmaClient.findFrameByName(page, frameName);
  if (!frameRef) throw new Error(`Frame "${frameName}" not found`);

  const frame = await figmaClient.getNode(fileKey, frameRef.id);
  const assets = findAssets(frame, []);

  const iconsDir = join(outputDir, "icons");
  const imagesDir = join(outputDir, "images");
  await mkdir(iconsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const results = { icons: [], images: [], failed: [] };
  const batchSize = 10;
  const totalBatches = Math.ceil(assets.length / batchSize);

  for (let i = 0; i < assets.length; i += batchSize) {
    const batch = assets.slice(i, i + batchSize);
    const ids = batch.map((a) => a.id).join(",");

    try {
      const svgData = await figmaClient.getImage(fileKey, ids, "svg");
      const pngData = await figmaClient.getImage(fileKey, ids, "png", 2);

      for (const asset of batch) {
        const safeName =
          asset.name
            .replace(/[^a-z0-9]/gi, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase() || "asset";

        try {
          if (asset.category === "icon" && svgData.images[asset.id]) {
            const svgResponse = await axios.get(svgData.images[asset.id]);
            const filePath = join(iconsDir, `${safeName}.svg`);
            await writeFile(filePath, svgResponse.data);
            results.icons.push({ name: safeName, path: filePath });
          } else if (pngData.images[asset.id]) {
            const pngResponse = await axios.get(pngData.images[asset.id], { responseType: "arraybuffer" });
            const filePath = join(imagesDir, `${safeName}.png`);
            await writeFile(filePath, Buffer.from(pngResponse.data));
            results.images.push({ name: safeName, path: filePath });
          }
        } catch (err) {
          results.failed.push({ name: safeName, error: err.message });
        }
      }
    } catch (err) {
      batch.forEach((a) => results.failed.push({ name: a.name, error: err.message }));
    }
  }

  const response = chunker.wrapResponse(
    {
      frame: frame.name,
      outputDir,
      summary: {
        icons: results.icons.length,
        images: results.images.length,
        failed: results.failed.length,
      },
      icons: results.icons.map((i) => i.path),
      images: results.images.map((i) => i.path),
      failed: results.failed,
    },
    {
      step: "Asset extraction complete",
      progress: `${results.icons.length} icons, ${results.images.length} images`,
      nextStep: "Assets saved to disk. Use extract_styles for design tokens.",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
