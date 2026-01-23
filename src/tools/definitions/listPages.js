import { z } from 'zod';

export const name = 'list_pages';

export const description = 'List all pages in a Figma file. Returns page names, IDs, and frame counts. Large files (>50 pages) auto-chunk; use continue:true for next batch.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key from URL (e.g., "h75vgHNcwxfHkRBbI53RRu")'),
  continue: z.boolean().optional().describe('Continue from last response if more pages available'),
};

export async function handler(args, ctx) {
  const { session, chunker, figmaClient } = ctx;
  const { file_key: fileKey, continue: continueFlag = false } = args;
  const operationId = `list_pages:${fileKey}`;

  if (continueFlag && session.hasPendingChunks(operationId)) {
    const chunk = session.getNextChunk(operationId);
    const response = chunker.wrapResponse(
      { pages: chunk.items },
      {
        step: `Showing pages ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
        progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
        nextStep: chunk.chunkIndex < chunk.totalChunks ? 'Call with continue=true for more' : 'Use list_frames to explore a page',
        operationId,
      }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 1);

  const pages = file.document.children.map((page) => {
    session.markPageExplored(page.id);
    return {
      name: page.name,
      id: page.id,
      frameCount: page.children?.filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT').length || 0,
    };
  });

  const chunked = chunker.chunkArray(pages, operationId, 20);

  if (chunked) {
    const response = chunker.wrapResponse(
      { file: file.name, lastModified: file.lastModified, pages: chunked.items },
      {
        step: `Showing pages 1-${chunked.items.length} of ${chunked.totalItems}`,
        progress: `1/${chunked.totalChunks}`,
        nextStep: 'Call with continue=true for more pages, or use list_frames to explore',
        alert: `File has ${pages.length} pages - showing first ${chunked.items.length}`,
        operationId,
      }
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(
    { file: file.name, lastModified: file.lastModified, pages },
    {
      step: 'Listed all pages',
      progress: `${pages.length} pages`,
      nextStep: 'Use list_frames(page_name) to explore frames in a page',
    }
  );

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
