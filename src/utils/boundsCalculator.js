export function calculateOverflow(parentBounds, childBounds) {
  const overflow = {
    left: Math.max(0, parentBounds.x - childBounds.x),
    right: Math.max(0, (childBounds.x + childBounds.width) - (parentBounds.x + parentBounds.width)),
    top: Math.max(0, parentBounds.y - childBounds.y),
    bottom: Math.max(0, (childBounds.y + childBounds.height) - (parentBounds.y + parentBounds.height))
  };

  const hasOverflow = overflow.left > 0 || overflow.right > 0 ||
                      overflow.top > 0 || overflow.bottom > 0;

  const maxOverflow = Math.max(overflow.left, overflow.right, overflow.top, overflow.bottom);

  return {
    hasOverflow,
    overflow,
    maxOverflow,
    totalOverflow: overflow.left + overflow.right + overflow.top + overflow.bottom,
    overflowDirections: Object.entries(overflow)
      .filter(([_, px]) => px > 0)
      .map(([dir, px]) => ({ direction: dir, pixels: px }))
  };
}

export function compareBounds(figmaBounds, browserBounds, tolerance = 2) {
  const diff = {
    x: browserBounds.x - figmaBounds.x,
    y: browserBounds.y - figmaBounds.y,
    width: browserBounds.width - figmaBounds.width,
    height: browserBounds.height - figmaBounds.height
  };

  const withinTolerance =
    Math.abs(diff.x) <= tolerance &&
    Math.abs(diff.y) <= tolerance &&
    Math.abs(diff.width) <= tolerance &&
    Math.abs(diff.height) <= tolerance;

  return {
    expected: figmaBounds,
    actual: browserBounds,
    diff,
    withinTolerance,
    maxDeviation: Math.max(Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.width), Math.abs(diff.height))
  };
}

export function isElementInside(containerBounds, elementBounds, margin = 0) {
  return (
    elementBounds.x >= containerBounds.x - margin &&
    elementBounds.y >= containerBounds.y - margin &&
    (elementBounds.x + elementBounds.width) <= (containerBounds.x + containerBounds.width + margin) &&
    (elementBounds.y + elementBounds.height) <= (containerBounds.y + containerBounds.height + margin)
  );
}

export function getRelativePosition(containerBounds, elementBounds) {
  return {
    relativeX: elementBounds.x - containerBounds.x,
    relativeY: elementBounds.y - containerBounds.y,
    percentX: ((elementBounds.x - containerBounds.x) / containerBounds.width) * 100,
    percentY: ((elementBounds.y - containerBounds.y) / containerBounds.height) * 100
  };
}
