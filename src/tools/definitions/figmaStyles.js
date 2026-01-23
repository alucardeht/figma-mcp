import { z } from 'zod';
import { resolveTarget, collectStyles } from '../../utils/index.js';
import { filterTokensByTypes, tokensToCSS, tokensToTailwind } from '../../utils/styleFormatters.js';

export const name = 'figma_styles';

export const description =
  'Extract and format design tokens/styles from Figma. Supports multiple output formats (tokens, CSS variables, Tailwind config) and scoping options (target node, file-wide, or both).';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
  node_id: z.string().optional().describe('Specific node ID to extract styles from'),
  page_name: z.string().optional().describe('Filter styles from specific page (partial match)'),
  frame_name: z.string().optional().describe('Filter styles from specific frame (partial match)'),
  query: z.string().optional().describe('Search query to find styles by name'),
  types: z
    .array(z.enum(['colors', 'fonts', 'fontSizes', 'spacing', 'radii', 'shadows', 'effects', 'grids']))
    .optional()
    .describe('Filter styles by type'),
  scope: z
    .enum(['target', 'file', 'both'])
    .optional()
    .default('target')
    .describe('Style scope: target (node), file (published), both (combined)'),
  format: z
    .enum(['tokens', 'css', 'tailwind'])
    .optional()
    .default('tokens')
    .describe('Output format: tokens (raw), css (CSS variables), tailwind (Tailwind config)'),
};

function extractPublishedStyles(fileData, query) {
  const tokens = {};

  if (fileData.styles) {
    Object.entries(fileData.styles).forEach(([styleId, styleData]) => {
      if (query && !styleData.name.toLowerCase().includes(query.toLowerCase())) {
        return;
      }

      const categoryMatch = styleData.name.match(/^([^/]+)\//);
      const category = categoryMatch ? categoryMatch[1].toLowerCase() : 'other';

      if (!tokens[category]) {
        tokens[category] = {};
      }

      const tokenName = styleData.name.split('/').pop();
      tokens[category][tokenName] = {
        id: styleId,
        name: styleData.name,
        value: styleData.description || tokenName,
      };
    });
  }

  return tokens;
}

function mergeTokens(targetTokens, fileTokens) {
  const merged = { ...fileTokens };

  Object.entries(targetTokens).forEach(([category, categoryTokens]) => {
    if (!merged[category]) {
      merged[category] = {};
    }
    merged[category] = { ...merged[category], ...categoryTokens };
  });

  return merged;
}

function countTokens(tokens) {
  let count = 0;
  Object.values(tokens).forEach((category) => {
    if (typeof category === 'object') {
      count += Object.keys(category).length;
    }
  });
  return count;
}

function formatStyleOutput(tokens, format) {
  switch (format) {
    case 'css':
      return tokensToCSS(tokens);

    case 'tailwind':
      return tokensToTailwind(tokens);

    case 'tokens':
    default:
      return {
        tokens,
        count: countTokens(tokens),
      };
  }
}

export async function handler(args, ctx) {
  const { file_key: fileKey, node_id: nodeId, page_name: pageName, frame_name: frameName, query, types = [], scope = 'target', format = 'tokens' } = args;

  const { figmaClient, chunker } = ctx;

  try {
    let targetTokens = {};
    let fileTokens = {};

    if (scope === 'target' || scope === 'both') {
      if (nodeId) {
        const file = await figmaClient.getFile(fileKey);
        const resolution = resolveTarget(file, {
          node_id: nodeId,
          page_name: pageName,
          frame_name: frameName,
        });

        if (!resolution.success) {
          throw new Error(`Target node not found: ${resolution.error}`);
        }

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
          const targetNode = findNode(page, resolution.target.id);
          if (targetNode) {
            targetTokens = collectStyles(targetNode, query) || {};
          }
        }
      }
    }

    if (scope === 'file' || scope === 'both') {
      const file = await figmaClient.getFile(fileKey);
      fileTokens = extractPublishedStyles(file, query);
    }

    let tokens = targetTokens;

    if (scope === 'both') {
      tokens = mergeTokens(targetTokens, fileTokens);
    } else if (scope === 'file') {
      tokens = fileTokens;
    }

    if (types.length > 0) {
      tokens = filterTokensByTypes(tokens, types);
    }

    const result = formatStyleOutput(tokens, format);

    const response = chunker.wrapResponse(result, {
      step: `Extracted ${format} styles from ${scope} scope`,
      progress: types.length > 0 ? `Types: ${types.join(', ')}` : 'All types',
      nextStep: format === 'tokens' ? 'Review tokens and choose CSS or Tailwind format' : 'Ready to use formatted output',
    });

    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: `Failed to extract styles: ${error.message}`,
              errorType: 'extraction_failed',
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
