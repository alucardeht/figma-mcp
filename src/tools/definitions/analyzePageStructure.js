import { z } from 'zod';
import { colorToHex, countElements } from '../../utils/index.js';
import { isIconNode, isImageNode } from '../../utils/assetHelpers.js';

export const name = 'analyze_page_structure';
export const description = 'Analyze page structure BEFORE implementation. Identifies sections by bg color, detects transitions, groups icons, estimates tokens, recommends agent count for parallel work.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  page_name: z.string().describe('Page name (partial match)'),
  frame_name: z.string().describe('Frame name (partial match)'),
};

const SECTION_KEYWORDS = {
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

function inferSectionName(elementName) {
  const lowerName = elementName.toLowerCase();

  for (const [sectionName, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => lowerName.includes(kw))) {
      return sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
    }
  }

  return null;
}

function getBackgroundColor(node) {
  if (!node.fills || node.fills.length === 0) {
    return null;
  }

  const solidFill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
  if (solidFill) {
    return colorToHex(solidFill.color);
  }

  return null;
}

function groupNodesBySection(children) {
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

function extractIconsAndImages(section, sectionId) {
  const icons = [];
  const images = [];

  function traverse(node) {
    if (isIconNode(node)) {
      icons.push({
        id: node.id,
        name: node.name,
        bounds: {
          x: Math.round(node.absoluteBoundingBox?.x || 0),
          y: Math.round(node.absoluteBoundingBox?.y || 0),
          width: Math.round(node.absoluteBoundingBox?.width || 0),
          height: Math.round(node.absoluteBoundingBox?.height || 0),
        },
      });
    } else if (isImageNode(node)) {
      images.push({
        id: node.id,
        name: node.name,
        bounds: {
          x: Math.round(node.absoluteBoundingBox?.x || 0),
          y: Math.round(node.absoluteBoundingBox?.y || 0),
          width: Math.round(node.absoluteBoundingBox?.width || 0),
          height: Math.round(node.absoluteBoundingBox?.height || 0),
        },
      });
    }

    const visibleChildren = node.children || [];
    for (const child of visibleChildren) {
      traverse(child);
    }
  }

  for (const node of section.nodes) {
    traverse(node);
  }

  return { icons, images };
}

function findTransitionElements(sections, frameChildren) {
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

function estimateTokens(frame) {
  const baseTokens = 1000;
  const childCount = countElements(frame);
  const tokensPerElement = 15;

  return baseTokens + (childCount * tokensPerElement);
}

export async function handler(args, ctx) {
  const { file_key, page_name, frame_name } = args;
  const { session, chunker, figmaClient } = ctx;

  session.setCurrentFile(file_key);
  const file = await figmaClient.getFile(file_key, 3);
  const page = figmaClient.findPageByName(file, page_name);

  if (!page) {
    const available = file.document.children.map((p) => p.name).join(', ');
    throw new Error(`Page "${page_name}" not found. Available: ${available}`);
  }

  const frameRef = figmaClient.findFrameByName(page, frame_name);
  if (!frameRef) {
    const available = (page.children || [])
      .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT')
      .map((f) => f.name)
      .join(', ');
    throw new Error(`Frame "${frame_name}" not found. Available: ${available}`);
  }

  const frame = await figmaClient.getNode(file_key, frameRef.id);
  const frameChildren = frame.children || [];

  const sectionGroups = groupNodesBySection(frameChildren);
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;

  const sections = sectionGroups.map((sectionGroup, idx) => {
    const firstNode = sectionGroup.nodes[0];
    const inferredName = inferSectionName(firstNode.name) || `Section ${idx + 1}`;

    const sectionBounds = {
      x: 0,
      y: Math.round(sectionGroup.minY - frameOffsetY),
      width: frame.absoluteBoundingBox?.width || 0,
      height: Math.round(sectionGroup.maxY - sectionGroup.minY),
    };

    const childCount = sectionGroup.nodes.reduce((sum, node) => sum + countElements(node), 0);

    return {
      id: `section-${idx}`,
      name: inferredName,
      bgColor: sectionGroup.bgColor || '#FFFFFF',
      bounds: sectionBounds,
      complexity: childCount <= 10 ? 'low' : childCount <= 30 ? 'medium' : 'high',
      childCount: childCount,
    };
  });

  const iconsBySection = {};
  const imagesBySection = {};

  for (let i = 0; i < sectionGroups.length; i++) {
    const { icons, images } = extractIconsAndImages(sectionGroups[i], `section-${i}`);
    if (icons.length > 0) iconsBySection[`section-${i}`] = icons;
    if (images.length > 0) imagesBySection[`section-${i}`] = images;
  }

  const transitionElements = findTransitionElements(sectionGroups, frameChildren);

  const totalTokens = estimateTokens(frame);
  const recommendedDivision = sections.length > 3 || totalTokens > 20000 ? 'multiple' : 'single';
  const recommendedAgentCount = Math.min(sections.length, Math.ceil(sections.length / 2));

  const result = {
    frame: frame.name,
    sections,
    transitionElements,
    iconsBySection,
    imagesBySection,
    totalEstimatedTokens: totalTokens,
    recommendedDivision,
    recommendedAgentCount,
  };

  const response = chunker.wrapResponse(result, {
    step: 'Analyzed page structure',
    progress: `${sections.length} sections identified`,
    nextStep: recommendedDivision === 'multiple'
      ? `Use get_section_screenshot or get_agent_context for parallel work (${recommendedAgentCount} agents)`
      : 'Use get_frame_info for full frame details',
    strategy: `Recommended: ${recommendedDivision} mode with ${recommendedAgentCount} agent${recommendedAgentCount > 1 ? 's' : ''}`,
  });

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
