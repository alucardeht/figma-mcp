import { z } from 'zod';
import { calculateOverflow } from '../../utils/boundsCalculator.js';

export const name = 'check_layout_bounds';

export const description = 'Detect overflow: child elements extending beyond parent bounds. Requires browser_bounds from chrome-devtools. Returns status, issues array, fix suggestions.';

const boundsObject = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});

export const inputSchema = {
  parent_selector: z.string().describe('CSS selector for the container element'),
  child_selectors: z.array(z.string()).describe('CSS selectors for child elements to check'),
  browser_bounds: z.record(z.string(), boundsObject).describe('Map of selector → {x, y, width, height} from browser. Get via chrome-devtools snapshot or evaluate_script.'),
  tolerance_px: z.number().default(2).describe('Tolerance in pixels for minor rounding differences (default: 2)')
};

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    parent_selector,
    child_selectors,
    browser_bounds,
    tolerance_px
  } = args;

  const parentBounds = browser_bounds[parent_selector];
  if (!parentBounds) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ERROR',
          error: `Parent element "${parent_selector}" not found in browser_bounds`,
          hint: 'Make sure to include parent bounds from chrome-devtools snapshot'
        }, null, 2)
      }]
    };
  }

  const issues = [];
  const checked = [];

  for (const childSelector of child_selectors) {
    const childBounds = browser_bounds[childSelector];

    if (!childBounds) {
      issues.push({
        severity: 'warning',
        element: childSelector,
        issue: 'not_found',
        message: `Element "${childSelector}" not found in DOM`
      });
      checked.push({ selector: childSelector, status: 'not_found' });
      continue;
    }

    const overflowResult = calculateOverflow(parentBounds, childBounds);

    if (overflowResult.hasOverflow && overflowResult.maxOverflow > tolerance_px) {
      const directions = overflowResult.overflowDirections
        .filter(d => d.pixels > tolerance_px)
        .map(d => `${d.direction}: ${d.pixels}px`)
        .join(', ');

      issues.push({
        severity: 'critical',
        element: childSelector,
        parent: parent_selector,
        issue: 'overflow',
        overflow_px: overflowResult.maxOverflow,
        overflow_details: overflowResult.overflow,
        message: `Element overflows container (${directions})`
      });
      checked.push({
        selector: childSelector,
        status: 'overflow',
        overflow: overflowResult.overflow
      });
    } else {
      checked.push({ selector: childSelector, status: 'ok' });
    }
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  const result = {
    status: criticalCount > 0 ? 'FAIL' : (warningCount > 0 ? 'WARNING' : 'PASS'),
    parent: parent_selector,
    parent_bounds: parentBounds,
    children_checked: child_selectors.length,
    issues,
    checked,
    summary: criticalCount > 0
      ? `${criticalCount} overflow issue(s) detected - elements extending beyond container bounds`
      : warningCount > 0
        ? `${warningCount} element(s) not found in DOM`
        : `All ${child_selectors.length} elements within bounds`
  };

  if (criticalCount > 0) {
    result.fix_suggestions = [
      'Check CSS flex/grid properties on parent container',
      'Verify min-width/max-width constraints',
      'Check if content needs to wrap at this viewport width',
      'Consider using overflow: hidden or overflow: auto on parent'
    ];
  }

  const response = chunker.wrapResponse(result, {
    step: 'Layout bounds validation',
    progress: `Checked ${child_selectors.length} elements`,
    nextStep: criticalCount > 0
      ? 'Fix overflow issues and revalidate'
      : 'Proceed to visual comparison'
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
  };
}
