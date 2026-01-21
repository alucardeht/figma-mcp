import { calculateOverflow, compareBounds, isElementInside, getRelativePosition } from '../../../utils/boundsCalculator.js';

export async function checkLayoutBounds(ctx, args) {
  const { chunker } = ctx;
  const {
    parent_selector,
    child_selectors,
    browser_bounds,
    tolerance_px = 2
  } = args;

  if (!parent_selector) {
    throw new Error('parent_selector is required');
  }
  if (!child_selectors || !Array.isArray(child_selectors)) {
    throw new Error('child_selectors must be an array');
  }
  if (!browser_bounds || typeof browser_bounds !== 'object') {
    throw new Error('browser_bounds must be an object mapping selectors to bounds');
  }

  const parentBounds = browser_bounds[parent_selector];
  if (!parentBounds) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "ERROR",
          error: `Parent element "${parent_selector}" not found in browser_bounds`,
          hint: "Make sure to include parent bounds from chrome-devtools snapshot"
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
        severity: "warning",
        element: childSelector,
        issue: "not_found",
        message: `Element "${childSelector}" not found in DOM`
      });
      checked.push({ selector: childSelector, status: "not_found" });
      continue;
    }

    const overflowResult = calculateOverflow(parentBounds, childBounds);

    if (overflowResult.hasOverflow && overflowResult.maxOverflow > tolerance_px) {
      const directions = overflowResult.overflowDirections
        .filter(d => d.pixels > tolerance_px)
        .map(d => `${d.direction}: ${d.pixels}px`)
        .join(', ');

      issues.push({
        severity: "critical",
        element: childSelector,
        parent: parent_selector,
        issue: "overflow",
        overflow_px: overflowResult.maxOverflow,
        overflow_details: overflowResult.overflow,
        message: `Element overflows container (${directions})`
      });
      checked.push({
        selector: childSelector,
        status: "overflow",
        overflow: overflowResult.overflow
      });
    } else {
      checked.push({ selector: childSelector, status: "ok" });
    }
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  const result = {
    status: criticalCount > 0 ? "FAIL" : (warningCount > 0 ? "WARNING" : "PASS"),
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
      "Check CSS flex/grid properties on parent container",
      "Verify min-width/max-width constraints",
      "Check if content needs to wrap at this viewport width",
      "Consider using overflow: hidden or overflow: auto on parent"
    ];
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Layout bounds validation",
    progress: `Checked ${child_selectors.length} elements`,
    nextStep: criticalCount > 0
      ? "Fix overflow issues and revalidate"
      : "Proceed to visual comparison"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}

export async function compareElementPosition(ctx, args) {
  const { chunker } = ctx;
  const {
    element_selector,
    figma_position,
    browser_position,
    relative_to,
    tolerance_px = 5
  } = args;

  if (!figma_position || !browser_position) {
    throw new Error('Both figma_position and browser_position are required');
  }

  const diff = {
    x: browser_position.x - figma_position.x,
    y: browser_position.y - figma_position.y
  };

  const withinTolerance =
    Math.abs(diff.x) <= tolerance_px &&
    Math.abs(diff.y) <= tolerance_px;

  const result = {
    status: withinTolerance ? "PASS" : "FAIL",
    element: element_selector,
    relative_to: relative_to || "viewport",
    figma_position,
    browser_position,
    deviation: diff,
    within_tolerance: withinTolerance,
    tolerance_used: tolerance_px
  };

  if (!withinTolerance) {
    result.message = `Element is ${Math.abs(diff.x)}px ${diff.x > 0 ? 'right' : 'left'} and ${Math.abs(diff.y)}px ${diff.y > 0 ? 'down' : 'up'} from expected position`;
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Position comparison"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}

export async function compareElementDimensions(ctx, args) {
  const { chunker } = ctx;
  const {
    element_selector,
    figma_dimensions,
    browser_dimensions,
    tolerance_percent = 2
  } = args;

  if (!figma_dimensions || !browser_dimensions) {
    throw new Error('Both figma_dimensions and browser_dimensions are required');
  }

  const widthDiff = browser_dimensions.width - figma_dimensions.width;
  const heightDiff = browser_dimensions.height - figma_dimensions.height;

  const widthDeviation = (Math.abs(widthDiff) / figma_dimensions.width) * 100;
  const heightDeviation = (Math.abs(heightDiff) / figma_dimensions.height) * 100;

  const withinTolerance =
    widthDeviation <= tolerance_percent &&
    heightDeviation <= tolerance_percent;

  const result = {
    status: withinTolerance ? "PASS" : "FAIL",
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

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Dimensions comparison"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}
