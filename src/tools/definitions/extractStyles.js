import { z } from 'zod';
import { collectStyles } from '../../utils/index.js';

export const name = 'extract_styles';

export const description = 'Extract design tokens from frame (colors, fonts, spacing, radius, shadows). Returns JSON ready for CSS/theme generation. Compact output, no chunking.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
  page_name: z.string().describe('Page name (partial match)'),
  frame_name: z.string().describe('Frame name (partial match)'),
};

export async function handler(args, ctx) {
  const { chunker, figmaClient } = ctx;
  const { file_key: fileKey, page_name: pageName, frame_name: frameName } = args;

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
      step: 'Design tokens extracted',
      progress: `${styles.colors.size} colors, ${styles.fonts.size} fonts`,
      nextStep: 'Use these tokens to build your theme/CSS, or extract_assets for icons/images',
    }
  );

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
