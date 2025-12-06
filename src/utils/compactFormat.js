function abbreviateColor(colorInput) {
  if (!colorInput || colorInput === 'none') return null;

  let hex = colorInput;

  if (typeof colorInput === 'object' && colorInput.r !== undefined && colorInput.g !== undefined && colorInput.b !== undefined) {
    const r = Math.round(colorInput.r * 255).toString(16).padStart(2, '0');
    const g = Math.round(colorInput.g * 255).toString(16).padStart(2, '0');
    const b = Math.round(colorInput.b * 255).toString(16).padStart(2, '0');
    hex = `#${r}${g}${b}`;
  }

  if (typeof hex !== 'string') return null;

  hex = hex.toLowerCase();
  if (hex.startsWith('#') && hex.length === 7) {
    const r = hex[1] + hex[2];
    const g = hex[3] + hex[4];
    const b = hex[5] + hex[6];

    if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1]) {
      return `#${r[0]}${g[0]}${b[0]}`;
    }
  }

  return hex;
}

function truncateText(text, maxLength = 30) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}

function formatBounds(node, parentBounds) {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) return '[?x?]';

  const x = parentBounds ? bounds.x - parentBounds.x : bounds.x;
  const y = parentBounds ? bounds.y - parentBounds.y : bounds.y;
  const w = Math.round(bounds.width);
  const h = Math.round(bounds.height);

  if (x === 0 && y === 0) {
    return `${w}x${h}`;
  }

  return `[${Math.round(x)},${Math.round(y)} ${w}x${h}]`;
}

function detectOverflow(node, parentBounds) {
  if (!parentBounds || !node.absoluteBoundingBox) return '';

  const bounds = node.absoluteBoundingBox;
  const nodeBottom = bounds.y + bounds.height;
  const nodeRight = bounds.x + bounds.width;

  const overflows = [];

  if (nodeBottom > parentBounds.y + parentBounds.height) {
    const overflow = Math.round(nodeBottom - (parentBounds.y + parentBounds.height));
    overflows.push(`↓overflow:${overflow}px`);
  }

  if (bounds.y < parentBounds.y) {
    const overflow = Math.round(parentBounds.y - bounds.y);
    overflows.push(`↑overflow:${overflow}px`);
  }

  if (nodeRight > parentBounds.x + parentBounds.width) {
    const overflow = Math.round(nodeRight - (parentBounds.x + parentBounds.width));
    overflows.push(`→overflow:${overflow}px`);
  }

  if (bounds.x < parentBounds.x) {
    const overflow = Math.round(parentBounds.x - bounds.x);
    overflows.push(`←overflow:${overflow}px`);
  }

  return overflows.length > 0 ? ' ' + overflows.join(' ') : '';
}

function formatNodeAttributes(node) {
  const attributes = [];

  if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
    const fill = node.fills[0];
    if (fill.type === 'SOLID' && fill.color) {
      const hex = fill.color.hex || fill.color;
      const abbreviated = abbreviateColor(hex);
      if (abbreviated) {
        attributes.push(`bg:${abbreviated}`);
      }
    }
  }

  if (node.cornerRadius) {
    attributes.push(`radius:${Math.round(node.cornerRadius)}`);
  }

  if (node.effects && node.effects.some(e => e.type === 'DROP_SHADOW' && e.visible)) {
    attributes.push('shadow');
  }

  if (node.layoutMode) {
    const layout = node.layoutMode === 'VERTICAL' ? 'col' : 'row';
    attributes.push(layout);

    if (node.itemSpacing) {
      attributes.push(`gap:${Math.round(node.itemSpacing)}`);
    }
  }

  return attributes;
}

function buildNodeType(node) {
  if (node.type === 'TEXT') return 'TEXT';
  if (node.type === 'VECTOR') return 'VECTOR';
  if (node.type === 'INSTANCE') return 'INSTANCE';
  return '';
}

function buildTreeLine(node, prefix, isLast, parentBounds) {
  const connector = isLast ? '└─' : '├─';
  const bounds = formatBounds(node, parentBounds);
  const nodeType = buildNodeType(node);
  const attributes = formatNodeAttributes(node);
  const overflow = detectOverflow(node, parentBounds);

  let line = `${prefix}${connector} ${node.name}`;

  if (node.type === 'TEXT' && node.characters) {
    const truncated = truncateText(node.characters);
    line += ` "${truncated}"`;
  }

  line += ` [${bounds}`;

  if (nodeType) {
    line += ` ${nodeType}`;
  }

  if (attributes.length > 0) {
    line += ` ${attributes.join(' ')}`;
  }

  line += `]${overflow}`;

  return line;
}

function getNodeBounds(node, parentBounds) {
  if (!node.absoluteBoundingBox) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
  }
  return node.absoluteBoundingBox;
}

function buildTree(node, prefix, parentBounds, depth, maxDepth, maxChildrenShown) {
  const lines = [];

  if (depth > maxDepth) {
    return lines;
  }

  const isLast = prefix.includes('└');
  const newPrefix = prefix.endsWith('└─ ') ? prefix.slice(0, -4) + '   ' :
                    prefix.endsWith('├─ ') ? prefix.slice(0, -4) + '│  ' : prefix;

  const children = node.children || [];
  const nodeBounds = getNodeBounds(node, parentBounds);

  if (children.length === 0) {
    return lines;
  }

  const visibleChildren = children.slice(0, maxChildrenShown);
  const hiddenCount = Math.max(0, children.length - maxChildrenShown);

  for (let i = 0; i < visibleChildren.length; i++) {
    const child = visibleChildren[i];
    const isLastChild = i === visibleChildren.length - 1 && hiddenCount === 0;
    const childPrefix = newPrefix + (isLastChild ? '└─' : '├─');

    lines.push(buildTreeLine(child, newPrefix, isLastChild, nodeBounds));

    if ((child.children && child.children.length > 0) || child.type === 'FRAME' || child.type === 'GROUP') {
      const childBounds = getNodeBounds(child, nodeBounds);
      const nextPrefix = newPrefix + (isLastChild ? '   ' : '│  ');
      const childLines = buildTree(child, nextPrefix, childBounds, depth + 1, maxDepth, maxChildrenShown);
      lines.push(...childLines);
    }
  }

  if (hiddenCount > 0) {
    const lastPrefix = newPrefix + '└─';
    lines.push(`${lastPrefix} ... +${hiddenCount} more`);
  }

  return lines;
}

export function frameToCompact(node, options = {}) {
  const {
    maxDepth = 10,
    maxChildrenShown = 10,
    includeText = true,
    parentBounds = null
  } = options;

  if (!node) {
    return '';
  }

  const bounds = formatBounds(node, parentBounds);
  const attributes = formatNodeAttributes(node);
  const nodeType = buildNodeType(node);
  const overflow = detectOverflow(node, parentBounds);

  let headerLine = `${node.name} [${bounds}`;

  if (nodeType) {
    headerLine += ` ${nodeType}`;
  }

  if (attributes.length > 0) {
    headerLine += ` ${attributes.join(' ')}`;
  }

  headerLine += `]${overflow}`;

  const lines = [headerLine];

  if (node.children && node.children.length > 0) {
    const nodeBounds = getNodeBounds(node, parentBounds);
    const treeLines = buildTree(node, '', nodeBounds, 0, maxDepth, maxChildrenShown);
    lines.push(...treeLines);
  }

  return lines.join('\n');
}
