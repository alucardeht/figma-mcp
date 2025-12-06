import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { findAssets, buildAssetName, buildAssetPath, getSectionFromPath, isCompositeGroup } from "../../utils/assetHelpers.js";

export async function extractAssets(ctx, fileKey, pageName, frameName, outputDir) {
  const { chunker, figmaClient } = ctx;

  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);
  if (!page) throw new Error(`Page "${pageName}" not found`);

  const frameRef = figmaClient.findFrameByName(page, frameName);
  if (!frameRef) throw new Error(`Frame "${frameName}" not found`);

  const frame = await figmaClient.getNode(fileKey, frameRef.id);
  const assets = findAssets(frame, { collectBounds: true });

  const iconsDir = join(outputDir, "icons");
  const imagesDir = join(outputDir, "images");
  const compositeDir = join(imagesDir, "composites");
  await mkdir(iconsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });
  await mkdir(compositeDir, { recursive: true });

  const results = { icons: [], images: [], composites: [], failed: [] };
  const assetMap = {};
  const batchSize = 10;

  for (let i = 0; i < assets.length; i += batchSize) {
    const batch = assets.slice(i, i + batchSize);
    const ids = batch.map((a) => a.id).join(",");

    try {
      const svgData = await figmaClient.getImage(fileKey, ids, "svg");
      const pngData = await figmaClient.getImage(fileKey, ids, "png", 2);

      for (const asset of batch) {
        try {
          if (asset.isComposite) {
            if (pngData.images[asset.id]) {
              const pngResponse = await axios.get(pngData.images[asset.id], { responseType: "arraybuffer" });
              const filePath = join(compositeDir, `${asset.name}.png`);
              await writeFile(filePath, Buffer.from(pngResponse.data));
              results.composites.push({
                path: filePath,
                uniqueName: asset.name,
                originalName: asset.originalName,
                section: getSectionFromPath(asset.path),
                bounds: asset.bounds,
                isComposite: true,
              });
              assetMap[asset.name] = filePath;
            }
          } else if (asset.category === "icon" && svgData.images[asset.id]) {
            const svgResponse = await axios.get(svgData.images[asset.id]);
            const filePath = join(iconsDir, `${asset.name}.svg`);
            await writeFile(filePath, svgResponse.data);
            results.icons.push({
              path: filePath,
              uniqueName: asset.name,
              originalName: asset.originalName,
              section: getSectionFromPath(asset.path),
              bounds: asset.bounds,
            });
            assetMap[asset.name] = filePath;
          } else if (pngData.images[asset.id]) {
            const pngResponse = await axios.get(pngData.images[asset.id], { responseType: "arraybuffer" });
            const filePath = join(imagesDir, `${asset.name}.png`);
            await writeFile(filePath, Buffer.from(pngResponse.data));
            results.images.push({
              path: filePath,
              uniqueName: asset.name,
              originalName: asset.originalName,
              section: getSectionFromPath(asset.path),
              bounds: asset.bounds,
            });
            assetMap[asset.name] = filePath;
          }
        } catch (err) {
          results.failed.push({
            name: asset.name,
            originalName: asset.originalName,
            error: err.message,
          });
        }
      }
    } catch (err) {
      batch.forEach((a) => results.failed.push({
        name: a.name,
        originalName: a.originalName,
        error: err.message,
      }));
    }
  }

  const response = chunker.wrapResponse(
    {
      frame: frame.name,
      outputDir,
      summary: {
        icons: results.icons.length,
        images: results.images.length,
        composites: results.composites.length,
        failed: results.failed.length,
      },
      icons: results.icons,
      images: results.images,
      composites: results.composites,
      assetMap,
      failed: results.failed,
    },
    {
      step: "Asset extraction complete",
      progress: `${results.icons.length} icons, ${results.images.length} images, ${results.composites.length} composite groups`,
      nextStep: "Assets saved to disk. Use extract_styles for design tokens.",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
