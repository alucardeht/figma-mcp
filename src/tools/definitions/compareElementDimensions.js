import { z } from 'zod';

export const name = 'compare_element_dimensions';

export const description = 'Compare element dimensions between Figma and browser. Returns status (PASS/FAIL), diff in pixels, deviation_percent. Default tolerance: 2%.';

const dimensionsObject = z.object({
  width: z.number(),
  height: z.number()
});

export const inputSchema = {
  element_selector: z.string().describe('CSS selector for the element'),
  figma_dimensions: dimensionsObject.describe('Expected dimensions from Figma'),
  browser_dimensions: dimensionsObject.describe('Actual dimensions from browser'),
  tolerance_percent: z.number().default(2).describe('Tolerance as percentage (default: 2%)')
};

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    element_selector,
    figma_dimensions,
    browser_dimensions,
    tolerance_percent
  } = args;

  const widthDiff = browser_dimensions.width - figma_dimensions.width;
  const heightDiff = browser_dimensions.height - figma_dimensions.height;

  const widthDeviation = (Math.abs(widthDiff) / figma_dimensions.width) * 100;
  const heightDeviation = (Math.abs(heightDiff) / figma_dimensions.height) * 100;

  const withinTolerance =
    widthDeviation <= tolerance_percent &&
    heightDeviation <= tolerance_percent;

  const result = {
    status: withinTolerance ? 'PASS' : 'FAIL',
    element: element_selector,
    figma_dimensions,
    browser_dimensions,
    diff: { width: widthDiff, height: heightDiff },
    deviation_percent: {
      width: widthDeviation.toFixed(1),
      height: heightDeviation.toFixed(1)
    },
    within_tolerance: withinTolerance,
    tolerance_used: `${tolerance_percent}%`
  };

  if (!withinTolerance) {
    const issues = [];
    if (widthDeviation > tolerance_percent) {
      issues.push(`width ${widthDiff > 0 ? 'larger' : 'smaller'} by ${Math.abs(widthDiff)}px (${widthDeviation.toFixed(1)}%)`);
    }
    if (heightDeviation > tolerance_percent) {
      issues.push(`height ${heightDiff > 0 ? 'larger' : 'smaller'} by ${Math.abs(heightDiff)}px (${heightDeviation.toFixed(1)}%)`);
    }
    result.message = `Element ${issues.join(' and ')}`;
  }

  const response = chunker.wrapResponse(result, {
    step: 'Dimensions comparison'
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
  };
}
