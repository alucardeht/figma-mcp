import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';

export const name = 'get_section_screenshot';
export const description = 'Capture section screenshot within frame. Call analyze_page_structure first. Makes other sections transparent, returns cropped image. Optional transition elements context.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL'),
  page_name: z.string().describe('Page name (partial match)'),
  frame_name: z.string().describe('Frame name (partial match)'),
  section_id: z.string().describe('Section ID from analyze_page_structure (e.g., "section-0")'),
  include_transition_context: z.boolean().optional().default(true).describe('Include margin context for transition elements (default: true)'),
  scale: z.number().optional().default(2).describe('Image scale 1-4 (default: 2)'),
};

function calculateSections(frame) {
  const children = frame.children || [];
  const frameOffsetY = frame.absoluteBoundingBox?.y || 0;

  if (!children || children.length === 0) {
    return [
      {
        id: 'section-0',
        name: frame.name,
        bounds: { x: 0, y: 0, width: frame.absoluteBoundingBox?.width || 0, height: frame.absoluteBoundingBox?.height || 0 },
        backgroundColor: extractBackgroundColor(frame),
        childCount: 0,
      },
    ];
  }

  const sections = [];
  let currentSection = null;
  let sectionIndex = 0;

  const sortedChildren = [...children].sort(
    (a, b) => (a.absoluteBoundingBox?.y || 0) - (b.absoluteBoundingBox?.y || 0)
  );

  for (const child of sortedChildren) {
    if (!child.absoluteBoundingBox) continue;

    const bgColor = extractBackgroundColor(child);

    if (!currentSection || bgColor !== currentSection.backgroundColor) {
      if (currentSection) {
        sections.push(currentSection);
      }

      currentSection = {
        id: `section-${sectionIndex}`,
        name: child.name,
        bounds: {
          x: 0,
          y: Math.round(child.absoluteBoundingBox.y - frameOffsetY),
          width: child.absoluteBoundingBox.width,
          height: child.absoluteBoundingBox.height,
        },
        backgroundColor: bgColor,
        childCount: 1,
        children: [child.id],
      };
      sectionIndex++;
    } else {
      currentSection.childCount++;
      currentSection.children.push(child.id);

      const childBottom = child.absoluteBoundingBox.y + child.absoluteBoundingBox.height;
      const sectionBottom = currentSection.bounds.y + currentSection.bounds.height;

      currentSection.bounds.height = Math.max(
        currentSection.bounds.height,
        childBottom - frameOffsetY - currentSection.bounds.y
      );
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections.length > 0
    ? sections
    : [
        {
          id: 'section-0',
          name: frame.name,
          bounds: { x: 0, y: 0, width: frame.absoluteBoundingBox?.width || 0, height: frame.absoluteBoundingBox?.height || 0 },
          backgroundColor: extractBackgroundColor(frame),
          childCount: frame.children.length,
        },
      ];
}

function extractBackgroundColor(node) {
  if (!node.fills || node.fills.length === 0) return 'transparent';

  const fill = node.fills.find((f) => f.visible !== false);
  if (!fill || !fill.color) return 'transparent';

  const { r, g, b, a } = fill.color;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${a || 1})`;
}

export async function handler(args, ctx) {
  const { file_key, page_name, frame_name, section_id, include_transition_context, scale } = args;
  const { chunker, figmaClient, session } = ctx;

  const file = await figmaClient.getFile(file_key, 2);
  const page = figmaClient.findPageByName(file, page_name);
  if (!page) throw new Error(`Page "${page_name}" not found`);

  const frame = figmaClient.findFrameByName(page, frame_name);
  if (!frame) throw new Error(`Frame "${frame_name}" not found`);

  const operationId = `section_structure:${file_key}:${page_name}:${frame_name}`;
  let sections = session.getCachedData(operationId);

  if (!sections) {
    sections = calculateSections(frame);
    session.setCachedData(operationId, sections);
  }

  const section = sections.find((s) => s.id === section_id);
  if (!section) {
    const availableIds = sections.map((s) => s.id).join(', ');
    throw new Error(`Section "${section_id}" not found. Available: ${availableIds}`);
  }

  const frameWidth = (frame.absoluteBoundingBox?.width || 0) * scale;
  const frameHeight = (frame.absoluteBoundingBox?.height || 0) * scale;

  const imageData = await figmaClient.getImage(file_key, frame.id, 'png', scale);

  const imageUrl = imageData.images[frame.id];
  if (!imageUrl) throw new Error('Failed to generate image');

  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

  let bounds = {
    x: Math.round(section.bounds.x * scale),
    y: Math.round(section.bounds.y * scale),
    width: Math.round(section.bounds.width * scale),
    height: Math.round(section.bounds.height * scale),
  };

  if (include_transition_context) {
    const margin = 20;
    bounds.x = Math.max(0, bounds.x - margin);
    bounds.y = Math.max(0, bounds.y - margin);
    bounds.width = Math.min(frameWidth - bounds.x, bounds.width + margin * 2);
    bounds.height = Math.min(frameHeight - bounds.y, bounds.height + margin * 2);
  }

  const croppedImage = await sharp(response.data)
    .extract({
      left: bounds.x,
      top: bounds.y,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
    .png()
    .toBuffer();

  const navInfo = chunker.wrapResponse(
    {
      sectionId: section.id,
      sectionName: section.name,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
      scale,
      format: 'png',
      originalBounds: {
        x: Math.round(section.bounds.x),
        y: Math.round(section.bounds.y),
        width: Math.round(section.bounds.width),
        height: Math.round(section.bounds.height),
      },
    },
    {
      step: 'Section screenshot captured',
      progress: 'Complete',
      nextStep: 'Use get_frame_info with section context for implementation details',
    }
  );

  return {
    content: [
      { type: 'text', text: JSON.stringify(navInfo, null, 2) },
      {
        type: 'image',
        data: croppedImage.toString('base64'),
        mimeType: 'image/png',
      },
    ],
  };
}
