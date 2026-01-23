import { z } from 'zod';

export const name = 'get_file_styles';

export const description = 'Get all published file styles (colors, text styles, effects). Returns official Figma design system tokens. Compact output, no chunking.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
};

export async function handler(args, ctx) {
  const { chunker, figmaClient } = ctx;
  const { file_key: fileKey } = args;

  const styles = await figmaClient.getStyles(fileKey);

  const organized = {
    colors: [],
    text: [],
    effects: [],
    grids: [],
  };

  for (const style of styles.meta?.styles || []) {
    const category =
      style.style_type === 'FILL'
        ? 'colors'
        : style.style_type === 'TEXT'
          ? 'text'
          : style.style_type === 'EFFECT'
            ? 'effects'
            : style.style_type === 'GRID'
              ? 'grids'
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
      step: 'File styles retrieved',
      progress: `${totalStyles} styles`,
      nextStep: 'Use extract_styles(frame) for frame-specific tokens',
    }
  );

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
