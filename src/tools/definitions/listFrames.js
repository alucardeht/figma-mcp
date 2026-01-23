import { z } from 'zod';

export const name = 'list_frames';

export const description = 'List frames/screens in a specific page by name (partial match). Returns frame names, sizes, IDs. Large pages (>50 frames) auto-chunk; use continue:true.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
  page_name: z.string().describe('Page name (partial match, case-insensitive)'),
  continue: z.boolean().optional().describe('Continue from last response if more frames available'),
};

export async function handler(args, ctx) {
  const { session, chunker, figmaClient } = ctx;
  const { file_key: fileKey, page_name: pageName, continue: continueFlag = false } = args;
  const operationId = `list_frames:${fileKey}:${pageName}`;

  if (continueFlag && session.hasPendingChunks(operationId)) {
    const chunk = session.getNextChunk(operationId);
    const response = chunker.wrapResponse(
      { frames: chunk.items },
      {
        step: `Showing frames ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
        progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
        nextStep: chunk.chunkIndex < chunk.totalChunks ? 'Call with continue=true for more' : 'Use get_frame_info to detail a frame',
        operationId,
      }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);

  if (!page) {
    const available = file.document.children.map((p) => p.name).join(', ');
    throw new Error(`Page "${pageName}" not found. Available: ${available}`);
  }

  const frames = (page.children || [])
    .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'COMPONENT_SET')
    .map((f) => {
      session.markFrameExplored(f.id);
      return {
        name: f.name,
        id: f.id,
        type: f.type,
        width: Math.round(f.absoluteBoundingBox?.width || 0),
        height: Math.round(f.absoluteBoundingBox?.height || 0),
        childCount: f.children?.length || 0,
      };
    });

  const chunked = chunker.chunkArray(frames, operationId, 20);

  if (chunked) {
    const response = chunker.wrapResponse(
      { page: page.name, frameCount: frames.length, frames: chunked.items },
      {
        step: `Showing frames 1-${chunked.items.length} of ${chunked.totalItems}`,
        progress: `1/${chunked.totalChunks}`,
        nextStep: 'Call with continue=true for more, or get_frame_info for details',
        alert: `Page has ${frames.length} frames - showing first ${chunked.items.length}`,
        strategy: 'Review visible frames, continue if needed, then detail specific ones',
        operationId,
      }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(
    { page: page.name, frameCount: frames.length, frames },
    {
      step: 'Listed all frames',
      progress: `${frames.length} frames`,
      nextStep: 'Use get_frame_info(frame_name) for structure, or extract_assets for icons/images',
    }
  );

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
