const DEFAULT_MAX_DEPTH = 4;

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
