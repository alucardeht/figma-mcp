import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import { colorToHex, collectStyles, countElements } from '../../utils/index.js';
import { isIconNode, isImageNode, buildAssetName, findAssets } from '../../utils/assetHelpers.js';

export const name = 'get_full_page_context';
export const description = 'Get complete page context in ONE call with lazy loading support. Returns sections, styles (default), and optional screenshots, assets, agent instructions. Perfect for parallel multi-agent work and quick complexity assessment.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  page_name: z.string().describe('Page name (partial match)'),
  frame_name: z.string().describe('Frame name (partial match)'),
  scale: z.number().optional().default(2).describe('Screenshot scale 1-4 (default: 2)'),
  include_screenshots: z.boolean().optional().default(false).describe('Include base64 screenshots for each section (default: false, saves bandwidth)'),
  include_assets: z.boolean().optional().default(false).describe('Include full asset objects with export URLs (default: false, only counts if false)'),
  include_styles: z.boolean().optional().default(true).describe('Include design tokens: colors, fonts, spacing, shadows (default: true)'),
  include_agent_instructions: z.boolean().optional().default(false).describe('Include detailed instructions for agents (default: false)'),
  include_asset_map: z.boolean().optional().default(false).describe('Include consolidated asset map (only used with include_assets=true, default: false)'),
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

function extractSectionAssets(sectionNodes, fileKey, sectionName, sectionId) {
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

function extractSectionStyles(sectionNodes) {
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

function extractMainElements(sectionNodes, maxCount = 5) {
  const elements = [];

  for (const node of sectionNodes) {
    if (elements.length >= maxCount) break;

    const childCount = countElements(node) - 1;
    elements.push({
      name: node.name,
      type: node.type,
      childCount,
    });
  }

  return elements;
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

async function captureFullFrameImage(ctx, fileKey, frame, scale = 2) {
  const { figmaClient } = ctx;

  try {
    const imageData = await figmaClient.getImage(fileKey, frame.id, 'png', scale);
    const imageUrl = imageData.images[frame.id];

    if (!imageUrl) return null;

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error) {
    console.error('Failed to capture frame image:', error.message);
    return null;
  }
}

async function extractSectionScreenshot(frameImageBuffer, sectionBounds, scale = 2) {
  if (!frameImageBuffer) return null;

  try {
    const bounds = {
      x: Math.round(sectionBounds.x * scale),
      y: Math.round(sectionBounds.y * scale),
      width: Math.round(sectionBounds.width * scale),
      height: Math.round(sectionBounds.height * scale),
    };

    const croppedImage = await sharp(frameImageBuffer)
      .extract({
        left: Math.max(0, bounds.x),
        top: Math.max(0, bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
      .png()
      .toBuffer();

    return croppedImage.toString('base64');
  } catch (error) {
    console.error('Failed to extract section screenshot:', error.message);
    return null;
  }
}

function buildAgentInstructions(section, agentIndex, totalAgents, assets, styles) {
  let instructions = `# Agent ${agentIndex} - ${section.name} Section\n\n`;

  instructions += `## Section Details\n`;
  instructions += `- Name: ${section.name}\n`;
  instructions += `- Position: Section ${agentIndex + 1} of ${totalAgents}\n`;
  instructions += `- Background: ${section.bgColor}\n`;
  instructions += `- Size: ${section.bounds.width}x${section.bounds.height}px\n\n`;

  if (assets.icons.length > 0 || assets.images.length > 0) {
    instructions += `## Available Assets\n`;

    if (assets.icons.length > 0) {
      instructions += `**Icons (${assets.icons.length}):**\n`;
      assets.icons.slice(0, 10).forEach((icon) => {
        instructions += `- ${icon.uniqueName}: ${icon.bounds.width}x${icon.bounds.height}px\n`;
      });
      if (assets.icons.length > 10) {
        instructions += `- ... and ${assets.icons.length - 10} more\n`;
      }
    }

    if (assets.images.length > 0) {
      instructions += `\n**Images (${assets.images.length}):**\n`;
      assets.images.slice(0, 5).forEach((image) => {
        instructions += `- ${image.uniqueName}: ${image.bounds.width}x${image.bounds.height}px\n`;
      });
      if (assets.images.length > 5) {
        instructions += `- ... and ${assets.images.length - 5} more\n`;
      }
    }
    instructions += '\n';
  }

  instructions += `## Design Tokens\n`;
  if (styles.colors.length > 0) {
    instructions += `**Colors (${styles.colors.length}):** ${styles.colors.slice(0, 5).join(', ')}${styles.colors.length > 5 ? ' ...' : ''}\n`;
  }
  if (styles.fonts.length > 0) {
    instructions += `**Fonts (${styles.fonts.length}):** ${styles.fonts.slice(0, 3).join(', ')}${styles.fonts.length > 3 ? ' ...' : ''}\n`;
  }
  if (styles.spacing.length > 0) {
    instructions += `**Spacing:** ${styles.spacing.slice(0, 5).join(', ')}px${styles.spacing.length > 5 ? ' ...' : ''}\n`;
  }

  instructions += `\n## Instructions\n`;
  if (agentIndex === 0) {
    instructions += `- You implement the FIRST section - ensure clean top boundary\n`;
  }
  if (agentIndex === totalAgents - 1) {
    instructions += `- You implement the LAST section - ensure clean bottom boundary\n`;
  }
  if (totalAgents > 1 && agentIndex > 0 && agentIndex < totalAgents - 1) {
    instructions += `- You implement a MIDDLE section - ensure clean top and bottom boundaries\n`;
  }
  instructions += `- Use asset names from the asset map for consistency\n`;
  instructions += `- Check screenshot for visual reference\n`;

  return instructions;
}

function countAssetsOnly(nodes) {
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

function countTotalAssets(sections) {
  let icons = 0;
  let images = 0;

  for (const section of sections) {
    icons += section.assets.icons.length;
    images += section.assets.images.length;
  }

  return { icons, images };
}

function buildAssetMap(sections) {
  const assetMap = {};

  for (const section of sections) {
    for (const icon of section.assets.icons) {
      assetMap[icon.uniqueName] = {
        sectionId: section.id,
        type: 'icon',
        exportUrl: icon.exportUrl,
      };
    }

    for (const image of section.assets.images) {
      assetMap[image.uniqueName] = {
        sectionId: section.id,
        type: 'image',
        exportUrl: image.exportUrl,
      };
    }
  }

  return assetMap;
}

export async function handler(args, ctx) {
  const {
    file_key: fileKey,
    page_name: pageName,
    frame_name: frameName,
    scale,
    include_screenshots,
    include_assets,
    include_styles,
    include_agent_instructions,
    include_asset_map,
  } = args;

  const { session, chunker, figmaClient } = ctx;

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 3);
  const page = figmaClient.findPageByName(file, pageName);

  if (!page) {
    const available = (file.document.children || []).map((p) => p.name).join(', ');
    throw new Error(`Page "${pageName}" not found. Available: ${available}`);
  }

  const frameRef = figmaClient.findFrameByName(page, frameName);
  if (!frameRef) {
    const available = (page.children || [])
      .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT')
      .map((f) => f.name)
      .join(', ');
    throw new Error(`Frame "${frameName}" not found. Available: ${available}`);
  }

  const frame = await figmaClient.getNode(fileKey, frameRef.id);
  const frameChildren = frame.children || [];

  const sectionGroups = groupNodesBySection(frameChildren);

  let frameImageBuffer = null;
  if (include_screenshots) {
    frameImageBuffer = await captureFullFrameImage(ctx, fileKey, frame, scale);
  }

  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;
  const sections = [];

  for (let idx = 0; idx < sectionGroups.length; idx++) {
    const sectionGroup = sectionGroups[idx];
    const firstNode = sectionGroup.nodes[0];
    const sectionName = inferSectionName(firstNode.name) || `Section ${idx + 1}`;

    const sectionBounds = {
      x: 0,
      y: Math.round(sectionGroup.minY - frameOffsetY),
      width: frame.absoluteBoundingBox?.width || 0,
      height: Math.round(sectionGroup.maxY - sectionGroup.minY),
    };

    const sectionNodes = [];
    for (const node of sectionGroup.nodes) {
      const collectNodes = (n) => {
        sectionNodes.push(n);
        const children = n.children || [];
        if (children.length > 0) {
          children.forEach(collectNodes);
        }
      };
      collectNodes(node);
    }

    let assets = null;
    let assetCount = null;

    if (include_assets) {
      assets = extractSectionAssets(
        sectionGroup.nodes,
        fileKey,
        sectionName,
        `section-${idx}`
      );
    } else {
      assetCount = countAssetsOnly(sectionGroup.nodes);
    }

    const styles = include_styles ? extractSectionStyles(sectionNodes) : null;
    const mainElements = extractMainElements(sectionGroup.nodes);

    let screenshot = null;
    if (include_screenshots && frameImageBuffer) {
      screenshot = await extractSectionScreenshot(frameImageBuffer, sectionBounds, scale);
    }

    const section = {
      id: `section-${idx}`,
      name: sectionName,
      bgColor: sectionGroup.bgColor || '#FFFFFF',
      bounds: {
        x: Math.round(sectionBounds.x),
        y: Math.round(sectionBounds.y),
        width: Math.round(sectionBounds.width),
        height: Math.round(sectionBounds.height),
      },
      mainElements,
    };

    if (include_styles) {
      section.styles = styles;
    }

    if (include_assets) {
      section.assets = assets;
    } else {
      section.assetCount = assetCount;
    }

    if (include_screenshots) {
      section.screenshot = screenshot;
    }

    sections.push(section);
  }

  let totalAssets = { icons: 0, images: 0 };
  if (include_assets) {
    totalAssets = countTotalAssets(sections);
  } else {
    for (const section of sections) {
      totalAssets.icons += section.assetCount.icons;
      totalAssets.images += section.assetCount.images;
    }
  }

  const transitionElements = findTransitionElements(sectionGroups, frameChildren);
  const recommendedAgentCount = Math.max(1, Math.min(sections.length, Math.ceil(sections.length / 2)));

  const overview = {
    frameName: frame.name,
    frameSize: {
      width: Math.round(frame.absoluteBoundingBox?.width || 0),
      height: Math.round(frame.absoluteBoundingBox?.height || 0),
    },
    sectionCount: sections.length,
    totalAssets,
    recommendedAgents: recommendedAgentCount,
    transitionElementCount: transitionElements.length,
  };

  const result = {
    overview,
    sections,
    transitionElements,
  };

  if (include_assets && include_asset_map) {
    result.assetMap = buildAssetMap(sections);
  }

  if (include_agent_instructions) {
    result.agentInstructions = sections.map((section, idx) =>
      buildAgentInstructions(section, idx, sections.length, section.assets || { icons: [], images: [] }, section.styles || {})
    );
  }

  const response = chunker.wrapResponse(result, {
    step: 'Full page context prepared',
    progress: `${sections.length} sections, ${totalAssets.icons} icons, ${totalAssets.images} images`,
    nextStep: `Distribute to ${recommendedAgentCount} agent${recommendedAgentCount > 1 ? 's' : ''} for parallel implementation`,
    strategy: `Lazy-loaded context: screenshots=${include_screenshots}, assets=${include_assets}, styles=${include_styles}, instructions=${include_agent_instructions}`,
  });

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
