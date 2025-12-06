export function colorToHex(color) {
  if (!color) return null;

  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = color.a !== undefined ? color.a : 1;

  if (a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
  }

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function extractFillInfo(fill) {
  if (fill.type === "SOLID") {
    return {
      type: "solid",
      color: colorToHex(fill.color),
      opacity: fill.opacity,
    };
  }

  if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") {
    return {
      type: fill.type.toLowerCase().replace("gradient_", ""),
      stops: fill.gradientStops?.map((s) => ({
        color: colorToHex(s.color),
        position: s.position,
      })),
    };
  }

  if (fill.type === "IMAGE") {
    return { type: "image", imageRef: fill.imageRef };
  }

  return { type: fill.type };
}
