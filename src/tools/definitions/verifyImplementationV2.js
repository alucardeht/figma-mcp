import { z } from 'zod';
import * as verifyElementsPresentModule from './verifyElementsPresent.js';
import * as verifyAssetsLoadedModule from './verifyAssetsLoaded.js';

export const name = 'verify_implementation_v2';

export const description = `Unified implementation verification: check DOM elements exist OR check assets loaded correctly. Set verification_type to choose the verification strategy.`;

const elementCheckObject = z.object({
  selector: z.string().describe('CSS selector for the element'),
  description: z.string().optional().describe('Human-readable description'),
  required: z.boolean().default(true).describe('Whether element is required')
});

const assetCheckObject = z.object({
  selector: z.string().describe('CSS selector for the asset element'),
  type: z.enum(['image', 'background', 'icon']).default('image'),
  description: z.string().optional().describe('Human-readable description')
});

export const inputSchema = {
  verification_type: z.enum(['elements', 'assets']).describe("Type: 'elements' (DOM presence verification) or 'assets' (image/icon loading verification)"),
  expected_elements: z.array(elementCheckObject).optional().describe('For elements: array of elements to check for'),
  browser_snapshot: z.union([z.object({}), z.string()]).optional().describe('For elements: DOM snapshot from chrome-devtools.take_snapshot()'),
  asset_checks: z.array(assetCheckObject).optional().describe('For assets: array of assets to verify'),
  browser_asset_info: z.record(z.string(), z.any()).optional().describe('For assets: map of selector → asset info from browser. Get via chrome-devtools.evaluate_script()')
};

export async function handler(args, ctx) {
  const { verification_type, ...rest } = args;

  switch (verification_type) {
    case 'elements':
      return verifyElementsPresentModule.handler(rest, ctx);
    case 'assets':
      return verifyAssetsLoadedModule.handler(rest, ctx);
    default:
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'ERROR',
            error: `Unknown verification_type: ${verification_type}. Use 'elements' or 'assets'.`
          }, null, 2)
        }]
      };
  }
}
