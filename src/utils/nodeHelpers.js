export function extractViewportFromNode(node) {
  const box = node?.absoluteBoundingBox || node?.bounds;

  if (!box || typeof box.width !== 'number' || typeof box.height !== 'number') {
    return null;
  }

  return {
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
}

export function extractBoundingBox(node) {
  const box = node?.absoluteBoundingBox || node?.bounds;

  if (!box) return null;

  return {
    x: Math.round(box.x || 0),
    y: Math.round(box.y || 0),
    width: Math.round(box.width || 0),
    height: Math.round(box.height || 0)
  };
}
