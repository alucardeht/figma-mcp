import { collectStyles, countElements, colorToHex } from "../../utils/index.js";
import { buildAssetName, findAssets } from "../../utils/assetHelpers.js";

function buildAgentInstructions(section, agentInfo, responsibilities, assets, styles) {
  const { index, total, isFirst, isLast } = agentInfo;
  const { implements: implementList, coordinates, skips } = responsibilities;

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
  instructions += "\n";

  instructions += `## What You Coordinate\n`;
  if (coordinates.length > 0) {
    instructions += `These elements span multiple sections and need coordination:\n`;
    coordinates.forEach((item) => {
      instructions += `- ${item} (handle carefully - may affect adjacent sections)\n`;
    });
  } else {
    instructions += `No transition elements affecting this section.\n`;
  }
  instructions += "\n";

  instructions += `## What You Skip\n`;
  if (skips.length > 0) {
    instructions += `These belong to other sections - do NOT implement:\n`;
    skips.forEach((item) => {
      instructions += `- ${item}\n`;
    });
  } else {
    instructions += `No elements to skip.\n`;
  }
  instructions += "\n";

  instructions += `## Assets Available\n`;
  if (assets.icons.length > 0) {
    instructions += `**Icons (${assets.icons.length}):**\n`;
    assets.icons.slice(0, 10).forEach((icon) => {
      instructions += `- ${icon.name} (${icon.bounds.width}x${icon.bounds.height}px)\n`;
    });
    if (assets.icons.length > 10) {
      instructions += `- ... and ${assets.icons.length - 10} more\n`;
    }
  }

  if (assets.images.length > 0) {
    instructions += `\n**Images (${assets.images.length}):**\n`;
    assets.images.slice(0, 5).forEach((image) => {
      instructions += `- ${image.name} (${image.bounds.width}x${image.bounds.height}px)\n`;
    });
    if (assets.images.length > 5) {
      instructions += `- ... and ${assets.images.length - 5} more\n`;
    }
  }

  if (assets.icons.length === 0 && assets.images.length === 0) {
    instructions += `No icons or images in this section.\n`;
  }
  instructions += "\n";

  instructions += `## Design Tokens\n`;
  if (styles.colors.length > 0) {
    instructions += `**Colors:** ${styles.colors.slice(0, 5).join(", ")}${styles.colors.length > 5 ? ` ... (${styles.colors.length} total)` : ""}\n`;
  }
  if (styles.fonts.length > 0) {
    instructions += `**Fonts:** ${styles.fonts.slice(0, 3).join(", ")}${styles.fonts.length > 3 ? ` ... (${styles.fonts.length} total)` : ""}\n`;
  }
  if (styles.spacing.length > 0) {
    instructions += `**Spacing:** ${styles.spacing.slice(0, 5).join(", ")}px${styles.spacing.length > 5 ? ` ... (${styles.spacing.length} total)` : ""}\n`;
  }

  instructions += "\n## Coordination Rules\n";
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

function extractSectionAssets(sectionNodeIds, frameAssets) {
  const sectionAssets = {
    icons: [],
    images: [],
  };

  for (const asset of frameAssets) {
    if (sectionNodeIds.includes(asset.id)) {
      if (asset.category === "icon") {
        sectionAssets.icons.push(asset);
      } else {
        sectionAssets.images.push(asset);
      }
    }
  }

  return sectionAssets;
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

function generateExportUrl(fileKey, nodeId, format = "png", scale = 2) {
  return `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=${format}&scale=${scale}`;
}

function buildAssetDetails(asset, fileKey, sectionName) {
  const baseName = asset.name || asset.originalName;
  const uniqueName = buildAssetName([baseName], {
    sectionName: sectionName,
  });

  return {
    id: asset.id,
    name: uniqueName,
    originalName: asset.originalName || asset.name,
    bounds: {
      x: Math.round(asset.bounds.x || 0),
      y: Math.round(asset.bounds.y || 0),
      width: Math.round(asset.bounds.width || 0),
      height: Math.round(asset.bounds.height || 0),
    },
    path: asset.path || [baseName],
    exportUrl: generateExportUrl(fileKey, asset.id, asset.category === "icon" ? "svg" : "png", 2),
  };
}

export async function getAgentContext(
  ctx,
  fileKey,
  pageName,
  frameName,
  sectionId,
  agentIndex = 0,
  totalAgents = 1
) {
  const { session, chunker, figmaClient } = ctx;

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 3);
  const page = figmaClient.findPageByName(file, pageName);

  if (!page) {
    const available = file.document.children.map((p) => p.name).join(", ");
    throw new Error(`Page "${pageName}" not found. Available: ${available}`);
  }

  const frameRef = figmaClient.findFrameByName(page, frameName);
  if (!frameRef) {
    const available = (page.children || [])
      .filter((c) => c.type === "FRAME" || c.type === "COMPONENT")
      .map((f) => f.name)
      .join(", ");
    throw new Error(`Frame "${frameName}" not found. Available: ${available}`);
  }

  const frame = await figmaClient.getNode(fileKey, frameRef.id);

  const sectionGroups = groupNodesBySection(frame.children || []);
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;

  const sectionIndex = parseInt(sectionId.split("-")[1], 10);
  if (sectionIndex < 0 || sectionIndex >= sectionGroups.length) {
    throw new Error(`Invalid section ID: ${sectionId}. Available: section-0 to section-${sectionGroups.length - 1}`);
  }

  const sectionGroup = sectionGroups[sectionIndex];
  const sectionName = inferSectionName(sectionGroup.nodes[0].name) || `Section ${sectionIndex + 1}`;

  const section = {
    id: sectionId,
    name: sectionName,
    bgColor: sectionGroup.bgColor || "#FFFFFF",
    bounds: {
      x: 0,
      y: Math.round(sectionGroup.minY - frameOffsetY),
      width: frame.absoluteBoundingBox?.width || 0,
      height: Math.round(sectionGroup.maxY - sectionGroup.minY),
    },
  };

  const sectionNodeIds = new Set();
  const sectionNodes = [];

  for (const node of sectionGroup.nodes) {
    const collectNodeIds = (n) => {
      sectionNodeIds.add(n.id);
      sectionNodes.push(n);
      (n.children || []).forEach(collectNodeIds);
    };
    collectNodeIds(node);
  }

  const frameAssets = findAssets(frame, {});

  const sectionAssets = extractSectionAssets(Array.from(sectionNodeIds), frameAssets);

  const enrichedAssets = {
    icons: sectionAssets.icons.map((a) => buildAssetDetails(a, fileKey, sectionName)),
    images: sectionAssets.images.map((a) => buildAssetDetails(a, fileKey, sectionName)),
  };

  const sectionStyles = extractSectionStyles(sectionNodes);

  const responsibilities = {
    implements: sectionGroup.nodes.map((n) => n.name),
    coordinates: [],
    skips: [],
  };

  const transitionElements = findTransitionElements(sectionGroups, frame.children || []);
  for (const element of transitionElements) {
    if (element.spansSections.includes(sectionId)) {
      responsibilities.coordinates.push(element.name);
    }
  }

  const allSectionIndices = new Set();
  for (let i = 0; i < sectionGroups.length; i++) {
    allSectionIndices.add(i);
  }
  allSectionIndices.delete(sectionIndex);
  for (const idx of allSectionIndices) {
    for (const node of sectionGroups[idx].nodes) {
      responsibilities.skips.push(node.name);
    }
  }

  const agentInfo = {
    index: agentIndex,
    total: totalAgents,
    isFirst: agentIndex === 0,
    isLast: agentIndex === totalAgents - 1,
  };

  const instructions = buildAgentInstructions(section, agentInfo, responsibilities, enrichedAssets, sectionStyles);

  const result = {
    section,
    responsibilities,
    assets: enrichedAssets,
    styles: sectionStyles,
    agentInfo,
    instructions,
  };

  const response = chunker.wrapResponse(result, {
    step: `Prepared context for Agent ${agentIndex}`,
    progress: `${section.name} section (${agentIndex + 1}/${totalAgents})`,
    nextStep: "Agent can now implement this section with all necessary context",
    alert: `Agent responsible for: ${responsibilities.implements.join(", ")}`,
  });

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
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

    const colorChanged = bgColor && bgColor !== currentBgColor && bgColor !== "#FFFFFF";
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

function getBackgroundColor(node) {
  if (!node.fills || node.fills.length === 0) {
    return null;
  }

  const solidFill = node.fills.find((f) => f.type === "SOLID" && f.visible !== false);
  if (solidFill) {
    return colorToHex(solidFill.color);
  }

  return null;
}

const SECTION_KEYWORDS = {
  hero: ["hero", "header", "banner", "top", "welcome"],
  about: ["about", "team", "info", "description", "story"],
  features: ["feature", "services", "capability", "benefit"],
  pricing: ["price", "plan", "cost", "billing"],
  contact: ["contact", "footer", "reach", "connect"],
  cta: ["cta", "call-to-action", "action", "button"],
  testimonial: ["testimonial", "review", "feedback", "quote"],
  faq: ["faq", "question", "answer", "qa"],
  gallery: ["gallery", "portfolio", "showcase", "grid"],
  form: ["form", "input", "field", "signup"],
  nav: ["nav", "navigation", "menu"],
  section: ["section", "container", "wrapper"],
};

function inferSectionName(elementName) {
  const lowerName = elementName.toLowerCase();

  for (const [sectionName, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some((kw) => lowerName.includes(kw))) {
      return sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
    }
  }

  return null;
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
