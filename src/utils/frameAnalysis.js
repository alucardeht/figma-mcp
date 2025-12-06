import { colorToHex, extractFillInfo } from "./colors.js";
import { isImageNode, isCompositeGroup } from "./assetHelpers.js";

export function countElements(node) {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countElements(child);
    }
  }
  return count;
}

export function analyzeFrame(node, depth, currentDepth = 0) {
  if (!node) return null;

  const result = {
    name: node.name,
    type: node.type,
    id: node.id,
  };

  if (node.absoluteBoundingBox) {
    result.bounds = {
      x: Math.round(node.absoluteBoundingBox.x),
      y: Math.round(node.absoluteBoundingBox.y),
      width: Math.round(node.absoluteBoundingBox.width),
      height: Math.round(node.absoluteBoundingBox.height),
    };

    const width = node.absoluteBoundingBox.width;
    const height = node.absoluteBoundingBox.height;
    if (width < 20 || height < 20) {
      result.isSmallElement = true;
      result.hint = "Small UI element - may need special attention";
    }
  }

  if (isCompositeGroup(node)) {
    result.isCompositeAsset = true;
    result.hint = "Export this group as single image - contains image + decorative shapes";
  }

  if (node.type === "TEXT") {
    result.text = node.characters;
    if (node.style) {
      result.textStyle = {
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
      };
    }
  }

  if (node.fills?.length > 0) {
    result.fills = node.fills
      .filter((f) => f.visible !== false)
      .map((f) => extractFillInfo(f));
  }

  if (node.strokes?.length > 0) {
    result.strokes = node.strokes.map((s) => ({
      color: colorToHex(s.color),
      weight: node.strokeWeight,
    }));
  }

  if (node.effects?.length > 0) {
    result.effects = node.effects.map((e) => ({
      type: e.type,
      radius: e.radius,
      color: e.color ? colorToHex(e.color) : null,
      offset: e.offset,
    }));
  }

  if (node.cornerRadius) {
    result.cornerRadius = node.cornerRadius;
  }

  if (node.paddingLeft || node.paddingTop || node.paddingRight || node.paddingBottom) {
    result.padding = {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0,
    };
  }

  if (node.itemSpacing) {
    result.gap = node.itemSpacing;
  }

  if (node.layoutMode) {
    result.layout = {
      mode: node.layoutMode,
      align: node.primaryAxisAlignItems,
      crossAlign: node.counterAxisAlignItems,
    };
  }

  if (currentDepth < depth && node.children?.length > 0) {
    result.children = node.children.map((child) => analyzeFrame(child, depth, currentDepth + 1));
  } else if (node.children?.length > 0) {
    result.childCount = node.children.length;
  }

  return result;
}

export function collectStyles(node, styles) {
  if (!node) return;

  if (node.fills) {
    node.fills.forEach((fill) => {
      if (fill.type === "SOLID" && fill.color) {
        styles.colors.add(colorToHex(fill.color));
      }
    });
  }

  if (node.strokes) {
    node.strokes.forEach((stroke) => {
      if (stroke.color) {
        styles.colors.add(colorToHex(stroke.color));
      }
    });
  }

  if (node.style) {
    if (node.style.fontFamily) styles.fonts.add(node.style.fontFamily);
    if (node.style.fontSize) styles.fontSizes.add(node.style.fontSize);
  }

  if (node.cornerRadius) styles.borderRadii.add(node.cornerRadius);
  if (node.paddingTop) styles.spacing.add(node.paddingTop);
  if (node.paddingRight) styles.spacing.add(node.paddingRight);
  if (node.paddingBottom) styles.spacing.add(node.paddingBottom);
  if (node.paddingLeft) styles.spacing.add(node.paddingLeft);
  if (node.itemSpacing) styles.spacing.add(node.itemSpacing);

  if (node.effects) {
    node.effects.forEach((effect) => {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const shadow = {
          type: effect.type,
          color: effect.color ? colorToHex(effect.color) : null,
          offset: effect.offset,
          radius: effect.radius,
          spread: effect.spread,
        };
        if (!styles.shadows.some((s) => JSON.stringify(s) === JSON.stringify(shadow))) {
          styles.shadows.push(shadow);
        }
      }
    });
  }

  if (node.children) {
    node.children.forEach((child) => collectStyles(child, styles));
  }
}
