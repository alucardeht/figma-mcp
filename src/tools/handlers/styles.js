import { collectStyles } from "../../utils/index.js";

export async function extractStyles(ctx, fileKey, pageName, frameName) {
  const { chunker, figmaClient } = ctx;

  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);
  if (!page) throw new Error(`Page "${pageName}" not found`);

  const frameRef = figmaClient.findFrameByName(page, frameName);
  if (!frameRef) throw new Error(`Frame "${frameName}" not found`);

  const frame = await figmaClient.getNode(fileKey, frameRef.id);

  const styles = {
    colors: new Set(),
    fonts: new Set(),
    fontSizes: new Set(),
    borderRadii: new Set(),
    spacing: new Set(),
    shadows: [],
  };

  collectStyles(frame, styles);

  const response = chunker.wrapResponse(
    {
      frame: frame.name,
      designTokens: {
        colors: [...styles.colors].sort(),
        fonts: [...styles.fonts].sort(),
        fontSizes: [...styles.fontSizes].sort((a, b) => a - b),
        borderRadii: [...styles.borderRadii].sort((a, b) => a - b),
        spacing: [...styles.spacing].sort((a, b) => a - b),
        shadows: styles.shadows,
      },
    },
    {
      step: "Design tokens extracted",
      progress: `${styles.colors.size} colors, ${styles.fonts.size} fonts`,
      nextStep: "Use these tokens to build your theme/CSS, or extract_assets for icons/images",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}

export async function getFileStyles(ctx, fileKey) {
  const { chunker, figmaClient } = ctx;

  const styles = await figmaClient.getStyles(fileKey);

  const organized = {
    colors: [],
    text: [],
    effects: [],
    grids: [],
  };

  for (const style of styles.meta?.styles || []) {
    const category =
      style.style_type === "FILL"
        ? "colors"
        : style.style_type === "TEXT"
          ? "text"
          : style.style_type === "EFFECT"
            ? "effects"
            : style.style_type === "GRID"
              ? "grids"
              : null;

    if (category) {
      organized[category].push({
        name: style.name,
        key: style.key,
        description: style.description,
      });
    }
  }

  const totalStyles = organized.colors.length + organized.text.length + organized.effects.length + organized.grids.length;

  const response = chunker.wrapResponse(
    { fileKey, styles: organized },
    {
      step: "File styles retrieved",
      progress: `${totalStyles} styles`,
      nextStep: "Use extract_styles(frame) for frame-specific tokens",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
