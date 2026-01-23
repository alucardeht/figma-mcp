import { colorToHex, collectStyles, countElements } from '../../utils/index.js';
import { isIconNode, isImageNode, buildAssetName } from '../../utils/assetHelpers.js';

const DEFAULT_MAX_DEPTH = 4;

export const SECTION_KEYWORDS = {
  hero: ['hero', 'header', 'banner', 'top', 'welcome'],
  about: ['about', 'team', 'info', 'description', 'story'],
  features: ['feature', 'services', 'capability', 'benefit'],
  pricing: ['price', 'plan', 'cost', 'billing'],
  contact: ['contact', 'footer', 'reach', 'connect'],
  cta: ['cta', 'call-to-action', 'action', 'button'],
  testimonial: ['testimonial', 'review', 'feedback', 'quote'],
  faq: ['faq', 'question', 'answer', 'qa'],
  gallery: ['gallery', 'portfolio', 'showcase', 'grid'],
  form: ['form', 'input', 'field', 'signup'],
  nav: ['nav', 'navigation', 'menu'],
  section: ['section', 'container', 'wrapper'],
};

export function inferSectionName(elementName) {
  const lowerName = elementName.toLowerCase();

  for (const [sectionName, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => lowerName.includes(kw))) {
      return sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
    }
  }

  return null;
}

export function getBackgroundColor(node) {
  if (!node.fills || node.fills.length === 0) {
    return null;
  }

  const solidFill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
  if (solidFill) {
    return colorToHex(solidFill.color);
  }

  return null;
}

export function groupNodesBySection(children) {
  const sections = [];
  let currentSection = null;
  let currentBgColor = null;
  let currentY = 0;

  for (const child of children) {
    if (!child.absoluteBoundingBox) continue;

    const bgColor = getBackgroundColor(child);
    const yPos = Math.round(child.absoluteBoundingBox.y);
    const heightDiff = Math.abs(yPos - currentY);

    const colorChanged = bgColor && bgColor !== currentBgColor && bgColor !== '#FFFFFF';
    const significantGap = heightDiff > 50;

    if (colorChanged || (significantGap && currentSection && currentSection.nodes.length > 0)) {
      if (currentSection && currentSection.nodes.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        nodes: [child],
        bgColor: bgColor || currentBgColor,
        minY: yPos,
        maxY: yPos + Math.round(child.absoluteBoundingBox.height),
      };
      currentBgColor = bgColor || currentBgColor;
    } else {
      if (!currentSection) {
        currentSection = {
          nodes: [child],
          bgColor: bgColor,
          minY: yPos,
          maxY: yPos + Math.round(child.absoluteBoundingBox.height),
        };
        currentBgColor = bgColor;
      } else {
        currentSection.nodes.push(child);
        currentSection.maxY = Math.max(
          currentSection.maxY,
          yPos + Math.round(child.absoluteBoundingBox.height)
        );
      }
    }

    currentY = yPos;
  }

  if (currentSection && currentSection.nodes.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

export function findTransitionElements(sections, frameChildren) {
  const transitionElements = [];

  for (const child of frameChildren) {
    if (!child.absoluteBoundingBox) continue;

    const childTop = Math.round(child.absoluteBoundingBox.y);
    const childBottom = childTop + Math.round(child.absoluteBoundingBox.height);

    let spanningSections = [];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (childTop < section.maxY && childBottom > section.minY) {
        spanningSections.push(`section-${i}`);
      }
    }

    if (spanningSections.length > 1) {
      transitionElements.push({
        id: child.id,
        name: child.name,
        type: child.type,
        bounds: {
          x: Math.round(child.absoluteBoundingBox.x),
          y: Math.round(child.absoluteBoundingBox.y),
          width: Math.round(child.absoluteBoundingBox.width),
          height: Math.round(child.absoluteBoundingBox.height),
        },
        spansSections: spanningSections,
      });
    }
  }

  return transitionElements;
}

export function extractSectionAssets(sectionNodes, fileKey, sectionName, sectionId) {
  const icons = [];
  const images = [];

  function traverse(node, path = []) {
    const currentPath = [...path, node.name];

    if (isIconNode(node)) {
      const uniqueName = buildAssetName(currentPath, { sectionName });
      icons.push({
        id: node.id,
        uniqueName,
        originalName: node.name,
        path: currentPath,
        bounds: {
          x: Math.round(node.absoluteBoundingBox?.x || 0),
          y: Math.round(node.absoluteBoundingBox?.y || 0),
          width: Math.round(node.absoluteBoundingBox?.width || 0),
          height: Math.round(node.absoluteBoundingBox?.height || 0),
        },
        exportUrl: `https://api.figma.com/v1/images/${fileKey}?ids=${node.id}&format=svg&scale=2`,
      });
    } else if (isImageNode(node)) {
      const uniqueName = buildAssetName(currentPath, { sectionName });
      images.push({
        id: node.id,
        uniqueName,
        originalName: node.name,
        path: currentPath,
        bounds: {
          x: Math.round(node.absoluteBoundingBox?.x || 0),
          y: Math.round(node.absoluteBoundingBox?.y || 0),
          width: Math.round(node.absoluteBoundingBox?.width || 0),
          height: Math.round(node.absoluteBoundingBox?.height || 0),
        },
        exportUrl: `https://api.figma.com/v1/images/${fileKey}?ids=${node.id}&format=png&scale=2`,
      });
    }

    if (node.children && !isIconNode(node) && !isImageNode(node)) {
      for (const child of node.children || []) {
        traverse(child, currentPath);
      }
    }
  }

  for (const node of sectionNodes) {
    traverse(node);
  }

  return { icons, images };
}

export function extractSectionStyles(sectionNodes) {
  const styles = {
    colors: new Set(),
    fonts: new Set(),
    fontSizes: new Set(),
    borderRadii: new Set(),
    spacing: new Set(),
    shadows: [],
  };

  for (const node of sectionNodes) {
    collectStyles(node, styles);
  }

  return {
    colors: [...styles.colors].sort(),
    fonts: [...styles.fonts].sort(),
    fontSizes: [...styles.fontSizes].sort((a, b) => a - b),
    borderRadii: [...styles.borderRadii].sort((a, b) => a - b),
    spacing: [...styles.spacing].sort((a, b) => a - b),
    shadows: styles.shadows,
  };
}

export function countAssetsOnly(nodes) {
  let icons = 0;
  let images = 0;

  function traverse(node) {
    if (isIconNode(node)) {
      icons++;
    } else if (isImageNode(node)) {
      images++;
    }

    if (node.children && !isIconNode(node) && !isImageNode(node)) {
      for (const child of node.children || []) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return { icons, images };
}

export function buildAgentInstructions(section, agentInfo, responsibilities, assets, styles) {
  const { index, total, isFirst, isLast } = agentInfo;
  const { implements: implementList = [], coordinates = [], skips = [] } = responsibilities;

  let instructions = `# Agent ${index} - ${section.name} Section\n\n`;

  instructions += `## Your Responsibility\n`;
  instructions += `You are responsible for implementing the **${section.name}** section.\n`;
  instructions += `- This is section ${index + 1} of ${total}\n`;
  instructions += `- Background color: ${section.bgColor}\n`;
  instructions += `- Bounds: ${section.bounds.width}x${section.bounds.height}px at (${section.bounds.x}, ${section.bounds.y})\n\n`;

  instructions += `## What You Implement\n`;
  if (implementList.length > 0) {
    instructions += `You fully implement these components:\n`;
    implementList.forEach((item) => {
      instructions += `- ${item}\n`;
    });
  } else {
    instructions += `No direct child components to implement.\n`;
  }
  instructions += '\n';

  instructions += `## What You Coordinate\n`;
  if (coordinates.length > 0) {
    instructions += `These elements span multiple sections and need coordination:\n`;
    coordinates.forEach((item) => {
      instructions += `- ${item} (handle carefully - may affect adjacent sections)\n`;
    });
  } else {
    instructions += `No transition elements affecting this section.\n`;
  }
  instructions += '\n';

  instructions += `## What You Skip\n`;
  if (skips.length > 0) {
    instructions += `These belong to other sections - do NOT implement:\n`;
    skips.forEach((item) => {
      instructions += `- ${item}\n`;
    });
  } else {
    instructions += `No elements to skip.\n`;
  }
  instructions += '\n';

  instructions += `## Assets Available\n`;
  if (assets.icons && assets.icons.length > 0) {
    instructions += `**Icons (${assets.icons.length}):**\n`;
    assets.icons.slice(0, 10).forEach((icon) => {
      const iconName = icon.uniqueName || icon.name;
      instructions += `- ${iconName} (${icon.bounds.width}x${icon.bounds.height}px)\n`;
    });
    if (assets.icons.length > 10) {
      instructions += `- ... and ${assets.icons.length - 10} more\n`;
    }
  }

  if (assets.images && assets.images.length > 0) {
    instructions += `\n**Images (${assets.images.length}):**\n`;
    assets.images.slice(0, 5).forEach((image) => {
      const imageName = image.uniqueName || image.name;
      instructions += `- ${imageName} (${image.bounds.width}x${image.bounds.height}px)\n`;
    });
    if (assets.images.length > 5) {
      instructions += `- ... and ${assets.images.length - 5} more\n`;
    }
  }

  if ((!assets.icons || assets.icons.length === 0) && (!assets.images || assets.images.length === 0)) {
    instructions += `No icons or images in this section.\n`;
  }
  instructions += '\n';

  instructions += `## Design Tokens\n`;
  if (styles.colors && styles.colors.length > 0) {
    instructions += `**Colors:** ${styles.colors.slice(0, 5).join(', ')}${styles.colors.length > 5 ? ` ... (${styles.colors.length} total)` : ''}\n`;
  }
  if (styles.fonts && styles.fonts.length > 0) {
    instructions += `**Fonts:** ${styles.fonts.slice(0, 3).join(', ')}${styles.fonts.length > 3 ? ` ... (${styles.fonts.length} total)` : ''}\n`;
  }
  if (styles.spacing && styles.spacing.length > 0) {
    instructions += `**Spacing:** ${styles.spacing.slice(0, 5).join(', ')}px${styles.spacing.length > 5 ? ` ... (${styles.spacing.length} total)` : ''}\n`;
  }

  instructions += '\n## Coordination Rules\n';
  if (isFirst && total > 1) {
    instructions += `- You are the **first agent** - ensure clean top boundary\n`;
  }
  if (isLast && total > 1) {
    instructions += `- You are the **last agent** - ensure clean bottom boundary\n`;
  }
  if (!isFirst && !isLast && total > 1) {
    instructions += `- You are a **middle agent** - ensure clean top and bottom boundaries\n`;
  }
  if (total === 1) {
    instructions += `- You are implementing the entire frame - ensure all boundaries are clean\n`;
  }

  instructions += `- Coordinate with adjacent agents through transition elements\n`;
  instructions += `- Test integration with the full layout\n`;

  return instructions;
}

export function rgbToHex(color) {
  if (!color) return '#000000';
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function extractStrokeStyle(node) {
  if (!node.strokes || node.strokes.length === 0) {
    return null;
  }

  const visibleStroke = node.strokes.find(s => s.type === 'SOLID' && s.visible !== false);
  if (!visibleStroke) return null;

  return {
    color: rgbToHex(visibleStroke.color),
    width: node.strokeWeight || 1,
    opacity: visibleStroke.opacity !== undefined ? visibleStroke.opacity : 1
  };
}

export function mapLayoutAlignment(alignment, layoutMode) {
  const alignmentMap = {
    'MIN': layoutMode === 'VERTICAL' ? 'flex-start' : 'flex-start',
    'CENTER': 'center',
    'MAX': layoutMode === 'VERTICAL' ? 'flex-end' : 'flex-end',
    'SPACE_BETWEEN': 'space-between'
  };
  return alignmentMap[alignment] || 'flex-start';
}

export function extractCssTree(node, maxDepth = DEFAULT_MAX_DEPTH, currentDepth = 0) {
  if (!node || currentDepth > maxDepth) return null;

  const css = {};

  if (node.absoluteBoundingBox) {
    css.width = Math.round(node.absoluteBoundingBox.width);
    css.height = Math.round(node.absoluteBoundingBox.height);
  }

  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
    if (solidFill) {
      css.backgroundColor = rgbToHex(solidFill.color);
      if (solidFill.opacity !== undefined && solidFill.opacity < 1) {
        css.opacity = solidFill.opacity;
      }
    }
  }

  if (node.layoutMode) {
    css.display = 'flex';
    css.flexDirection = node.layoutMode === 'VERTICAL' ? 'column' : 'row';
    if (node.itemSpacing) css.gap = node.itemSpacing;

    if (node.primaryAxisAlignItems) {
      css.justifyContent = mapLayoutAlignment(node.primaryAxisAlignItems, node.layoutMode);
    }
    if (node.counterAxisAlignItems) {
      css.alignItems = mapLayoutAlignment(node.counterAxisAlignItems, node.layoutMode);
    }
  }

  if (node.paddingTop !== undefined || node.paddingRight !== undefined || node.paddingBottom !== undefined || node.paddingLeft !== undefined) {
    css.padding = {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0
    };
  }

  if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
    css.borderRadius = node.cornerRadius;
  }

  const stroke = extractStrokeStyle(node);
  if (stroke) {
    css.border = {
      color: stroke.color,
      width: stroke.width,
      opacity: stroke.opacity
    };
  }

  if (node.type === 'TEXT' && node.style) {
    css.fontFamily = node.style.fontFamily || 'sans-serif';
    css.fontSize = node.style.fontSize || 12;
    css.fontWeight = node.style.fontWeight || 400;
    if (node.style.lineHeightPx) css.lineHeight = node.style.lineHeightPx;
    if (node.style.letterSpacing) css.letterSpacing = node.style.letterSpacing;
    if (node.style.textAlignHorizontal) {
      css.textAlign = node.style.textAlignHorizontal.toLowerCase();
    }
  }

  const result = {
    name: node.name,
    type: node.type,
    css
  };

  if (node.type === 'TEXT' && node.characters) {
    result.text = node.characters.substring(0, 100);
  }

  if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
    result.children = node.children
      .map(child => extractCssTree(child, maxDepth, currentDepth + 1))
      .filter(Boolean);
  }

  return result;
}

export function determineSectionStatus(matchScore, passThreshold) {
  return matchScore >= passThreshold ? 'PASS' : 'FAIL';
}

export function determineOverallStatus(failedCount, totalSections) {
  return failedCount === 0 && totalSections > 0
    ? 'PASS'
    : failedCount > 0 && failedCount < totalSections
      ? 'PARTIAL'
      : 'FAIL';
}

export function analyzeSectionProblems(regions, section) {
  const problems = [];

  for (const region of regions) {
    if (region.mismatchPercentage > 5) {
      problems.push({
        area: region.area,
        severity: region.mismatchPercentage > 15 ? 'critical' : 'moderate',
        description: `${region.mismatchPercentage.toFixed(1)}% pixels differ in ${region.area} region`
      });
    }
  }

  const severityOrder = { critical: 2, moderate: 1 };
  return problems.sort((a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0)).slice(0, 5);
}

export function buildDependencyMap(transitionElements, sections) {
  const dependencies = [];

  for (const element of transitionElements) {
    if (element.spansSections.length > 1) {
      const affectedSections = element.spansSections;
      const baseSection = affectedSections[0];
      const dependentSections = affectedSections.slice(1);

      const explanation = `${element.name} spans from ${baseSection} to ${dependentSections.join(', ')}. Implements visual connection between sections.`;

      dependencies.push({
        element: element.name,
        elementId: element.id,
        type: 'cross_section_element',
        affectedSections: affectedSections,
        dependsOn: [baseSection],
        explanation,
        recommendation: `Validate ${baseSection} first, then validate with dependent sections visible`
      });
    }
  }

  return dependencies;
}

export function calculateImplementationOrder(sections, dependencies) {
  const implemented = new Set();
  const order = [];

  while (implemented.size < sections.length) {
    for (let i = 0; i < sections.length; i++) {
      const sectionId = `section-${i}`;
      if (implemented.has(sectionId)) continue;

      const sectionDeps = dependencies.filter(d => d.affectedSections.includes(sectionId));
      const allDepsSatisfied = sectionDeps.every(dep =>
        dep.dependsOn.every(depId => implemented.has(depId))
      );

      if (allDepsSatisfied) {
        order.push({
          priority: order.length + 1,
          sectionId,
          sectionName: sections[i].name,
          reason: sectionDeps.length > 0
            ? `${sectionDeps[0].explanation}`
            : 'Independent section'
        });
        implemented.add(sectionId);
      }
    }

    if (order.length === implemented.size && implemented.size < sections.length) {
      for (let i = 0; i < sections.length; i++) {
        const sectionId = `section-${i}`;
        if (!implemented.has(sectionId)) {
          order.push({
            priority: order.length + 1,
            sectionId,
            sectionName: sections[i].name,
            reason: 'Circular dependency or independent section'
          });
          implemented.add(sectionId);
        }
      }
    }
  }

  return order;
}

export function buildSectionLegend() {
  return {
    status_meaning: {
      PASS: 'Seção com match >= 95% - pixel-perfect implementação',
      FAIL: 'Seção com match < 95% - requer ajustes de CSS/layout'
    },
    section_fields: {
      match_score: 'Percentual de pixels idênticos entre Figma e implementação (0-100)',
      css_tree: 'Hierarquia CSS extraída do Figma com propriedades de cada elemento',
      problems: 'Regiões específicas com diferenças detectadas (top, center, bottom, etc)',
      bounds: 'Posição (x,y) e dimensões (width, height) da seção na página',
      bgColor: 'Cor de fundo principal da seção em hex'
    },
    dependency_meaning: 'Elementos que atravessam múltiplas seções (ex: navbar transparente) precisam ser implementados juntos com a seção base',
    implementation_order: 'Ordem sugerida considera dependências - seções base sem dependências devem ser implementadas primeiro',
    pass_threshold: 'Limite mínimo de match para considerar seção validada (padrão 95%)'
  };
}
