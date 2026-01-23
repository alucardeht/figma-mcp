import { z } from 'zod';

export const name = 'compare_element_position';

export const description = 'Compare element position between Figma and browser. Returns status (PASS/FAIL), deviation in pixels, within_tolerance boolean. Default tolerance: 5px.';

const positionObject = z.object({
  x: z.number(),
  y: z.number()
});

export const inputSchema = {
  element_selector: z.string().describe('CSS selector for the element'),
  figma_position: positionObject.describe('Expected position from Figma'),
  browser_position: positionObject.describe('Actual position from browser'),
  relative_to: z.string().optional().describe('Optional: selector of reference element for relative positioning'),
  tolerance_px: z.number().default(5).describe('Tolerance in pixels (default: 5)')
};

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    element_selector,
    figma_position,
    browser_position,
    relative_to,
    tolerance_px
  } = args;

  const diff = {
    x: browser_position.x - figma_position.x,
    y: browser_position.y - figma_position.y
  };

  const withinTolerance =
    Math.abs(diff.x) <= tolerance_px &&
    Math.abs(diff.y) <= tolerance_px;

  const result = {
    status: withinTolerance ? 'PASS' : 'FAIL',
    element: element_selector,
    relative_to: relative_to || 'viewport',
    figma_position,
    browser_position,
    deviation: diff,
    within_tolerance: withinTolerance,
    tolerance_used: tolerance_px
  };

  if (!withinTolerance) {
    result.message = `Element is ${Math.abs(diff.x)}px ${diff.x > 0 ? 'right' : 'left'} and ${Math.abs(diff.y)}px ${diff.y > 0 ? 'down' : 'up'} from expected position`;
  }

  const response = chunker.wrapResponse(result, {
    step: 'Position comparison'
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
  };
}
