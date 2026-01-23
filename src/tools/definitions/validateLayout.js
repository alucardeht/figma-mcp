import { z } from 'zod';
import * as checkLayoutBoundsModule from './checkLayoutBounds.js';
import * as compareElementPositionModule from './compareElementPosition.js';
import * as compareElementDimensionsModule from './compareElementDimensions.js';

export const name = 'validate_layout';

export const description = 'Unified layout validation: overflow detection, position comparison, or dimension comparison. Set validation_type to choose the validation strategy.';

const boundsObject = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

const positionObject = z.object({
  x: z.number(),
  y: z.number()
});

const dimensionsObject = z.object({
  width: z.number(),
  height: z.number()
});

export const inputSchema = {
  validation_type: z.enum(['overflow', 'position', 'dimensions']).describe("Type: 'overflow' (child extends parent), 'position' (x,y comparison), 'dimensions' (width,height comparison)"),
  parent_selector: z.string().optional().describe('For overflow: parent CSS selector'),
  child_selectors: z.array(z.string()).optional().describe('For overflow: child CSS selectors'),
  browser_bounds: z.record(z.string(), boundsObject).optional().describe('For overflow/position/dimensions: map of selector → {x, y, width, height}'),
  tolerance_px: z.number().optional().describe('For overflow/position: pixel tolerance (default: 2 for overflow, 5 for position)'),
  element_selector: z.string().optional().describe('For position/dimensions: element CSS selector'),
  figma_position: positionObject.optional().describe('For position: expected position from Figma'),
  browser_position: positionObject.optional().describe('For position: actual position from browser'),
  relative_to: z.string().optional().describe('For position: reference element selector'),
  figma_dimensions: dimensionsObject.optional().describe('For dimensions: expected dimensions from Figma'),
  browser_dimensions: dimensionsObject.optional().describe('For dimensions: actual dimensions from browser'),
  tolerance_percent: z.number().optional().describe('For dimensions: percentage tolerance (default: 2)')
};

export async function handler(args, ctx) {
  const { validation_type, ...rest } = args;

  switch (validation_type) {
    case 'overflow':
      return checkLayoutBoundsModule.handler(rest, ctx);
    case 'position':
      return compareElementPositionModule.handler(rest, ctx);
    case 'dimensions':
      return compareElementDimensionsModule.handler(rest, ctx);
    default:
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'ERROR',
            error: `Unknown validation_type: ${validation_type}. Use 'overflow', 'position', or 'dimensions'.`
          }, null, 2)
        }]
      };
  }
}
