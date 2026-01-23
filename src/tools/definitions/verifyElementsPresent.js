import { z } from 'zod';

export const name = 'verify_elements_present';

export const description = `Verify expected elements exist in browser DOM. Requires browser_snapshot from chrome-devtools. Returns status, found/missing counts, per-element suggestions.`;

const elementCheckObject = z.object({
  selector: z.string().describe('CSS selector for the element'),
  description: z.string().optional().describe('Human-readable description'),
  required: z.boolean().default(true).describe('Whether element is required')
});

export const inputSchema = {
  expected_elements: z.array(elementCheckObject).describe('Array of elements to check for'),
  browser_snapshot: z.union([z.object({}), z.string()]).describe('DOM snapshot from chrome-devtools.take_snapshot()')
};

function checkElementInSnapshot(snapshot, selector) {
  if (typeof snapshot === 'string') {
    const selectorPatterns = [
      selector,
      selector.replace('.', 'class="'),
      selector.replace('#', 'id="'),
      selector.replace(/\[([^\]]+)\]/, '$1')
    ];

    return selectorPatterns.some(pattern => snapshot.includes(pattern));
  }

  if (snapshot.elements && Array.isArray(snapshot.elements)) {
    return snapshot.elements.some(el =>
      el.selector === selector ||
      el.id === selector.replace('#', '') ||
      el.className?.includes(selector.replace('.', ''))
    );
  }

  if (snapshot.content) {
    return checkElementInSnapshot(snapshot.content, selector);
  }

  return JSON.stringify(snapshot).includes(selector);
}

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    expected_elements,
    browser_snapshot
  } = args;

  const results = [];
  let foundCount = 0;
  let missingCount = 0;

  for (const element of expected_elements) {
    const { selector, description, required } = element;

    const found = checkElementInSnapshot(browser_snapshot, selector);

    if (found) {
      foundCount++;
      results.push({
        selector,
        description,
        status: 'found',
        required
      });
    } else {
      if (required) missingCount++;
      results.push({
        selector,
        description,
        status: 'missing',
        required,
        suggestion: `Element "${selector}" not found. Check if: 1) selector matches implementation, 2) element is rendered at current viewport, 3) element is not hidden by CSS`
      });
    }
  }

  const status = missingCount > 0 ? 'FAIL' : 'PASS';

  const result = {
    status,
    total: expected_elements.length,
    found: foundCount,
    missing: missingCount,
    elements: results,
    summary: missingCount > 0
      ? `${missingCount} required element(s) missing from DOM`
      : `All ${foundCount} expected elements found`
  };

  if (missingCount > 0) {
    result.fix_suggestions = [
      'Verify CSS selectors match your implementation',
      'Check if elements are conditionally rendered',
      'Ensure elements are not hidden with display:none or visibility:hidden',
      'For responsive elements, verify they exist at current viewport width'
    ];
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: 'Elements presence check',
    progress: `Checked ${expected_elements.length} elements`,
    nextStep: missingCount > 0 ? 'Add missing elements' : 'Proceed to asset loading check'
  }) : result;

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
  };
}
