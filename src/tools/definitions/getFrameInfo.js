import { z } from 'zod';
import { countElements, analyzeFrame } from '../../utils/index.js';

export const name = 'get_frame_info';

export const description = 'Get detailed frame info (components, text, colors, styles). Call FIRST before screenshots. Use node_id for fast access OR page_name+frame_name. Depth param controls detail level.';

export const inputSchema = {
  file_key: z.string().describe('Figma file key'),
  page_name: z.string().optional().describe('Page name (partial match). Use with frame_name or provide node_id instead.'),
  frame_name: z.string().optional().describe('Frame name (partial match). Use with page_name or provide node_id instead.'),
  node_id: z.string().optional().describe('Figma node ID from URL (format: 40000056-28165). Alternative to page_name+frame_name - provides direct fast access.'),
  depth: z.number().optional().default(2).describe('How deep to traverse (1=direct children, 2=grandchildren). Default: 2'),
  continue: z.boolean().optional().describe('Continue from last response'),
};

export async function handler(args, ctx) {
  const { session, chunker, figmaClient } = ctx;
  const {
    file_key: fileKey,
    page_name: pageName,
    frame_name: frameName,
    node_id: nodeId,
    depth = 2,
    continue: continueFlag = false,
  } = args;

  let frame;
  let operationId;

  if (nodeId) {
    operationId = `get_frame_info:${fileKey}:${nodeId}`;

    if (continueFlag && session.hasPendingChunks(operationId)) {
      const chunk = session.getNextChunk(operationId);
      const response = chunker.wrapResponse(
        { children: chunk.items },
        {
          step: `Showing children ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
          progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
          nextStep: chunk.chunkIndex < chunk.totalChunks ? 'Call with continue=true for more' : 'Use extract_styles or extract_assets',
          operationId,
        }
      );
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }

    session.setCurrentFile(fileKey);
    const cachedFrame = session.getFrameInfoByNodeId(fileKey, nodeId);
    if (cachedFrame) {
      frame = cachedFrame;
    } else {
      frame = await figmaClient.getNodeById(fileKey, nodeId);
      session.cacheFrameInfoByNodeId(fileKey, nodeId, frame);
    }

    if (!frame) throw new Error(`Node "${nodeId}" not found or not accessible`);
  } else {
    operationId = `get_frame_info:${fileKey}:${pageName}:${frameName}`;

    if (continueFlag && session.hasPendingChunks(operationId)) {
      const chunk = session.getNextChunk(operationId);
      const response = chunker.wrapResponse(
        { children: chunk.items },
        {
          step: `Showing children ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
          progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
          nextStep: chunk.chunkIndex < chunk.totalChunks ? 'Call with continue=true for more' : 'Use extract_styles or extract_assets',
          operationId,
        }
      );
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }

    session.setCurrentFile(fileKey);
    const file = await figmaClient.getFile(fileKey, 2);
    const page = figmaClient.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frameRef = figmaClient.findFrameByName(page, frameName);
    if (!frameRef) {
      const available = (page.children || [])
        .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT')
        .map((f) => f.name)
        .join(', ');
      throw new Error(`Frame "${frameName}" not found. Available: ${available}`);
    }

    frame = await figmaClient.getNode(fileKey, frameRef.id);
  }

  const childCount = countElements(frame);
  const { tokenEstimator } = ctx;

  const estimatedTokens = tokenEstimator ? tokenEstimator.estimate(frame) : null;

  if (estimatedTokens && estimatedTokens > 10000) {
    const response = chunker.wrapResponse(
      {
        warning: 'Frame muito grande para processar diretamente',
        estimated_tokens: estimatedTokens,
        element_count: childCount,
        recommended_action: 'Use analyze_page_structure primeiro ou reduza o escopo',
      },
      ctx
    );
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  if (childCount > 1000) {
    const summary = analyzeFrame(frame, 1);
    const response = chunker.wrapResponse(summary, {
      step: 'Frame summary (large frame detected)',
      progress: `~${childCount} elements`,
      nextStep: 'Request specific child by name, or use depth=1 for top-level only',
      alert: `Frame has ~${childCount} elements - showing summary`,
      strategy: 'Use depth=1 for overview, then drill into specific sections',
    });
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  const analysis = analyzeFrame(frame, depth);

  if (analysis.children && analysis.children.length > 20) {
    const chunked = chunker.chunkArray(analysis.children, operationId, 20);
    const firstBatch = { ...analysis, children: chunked.items };

    const response = chunker.wrapResponse(firstBatch, {
      step: `Showing children 1-${chunked.items.length} of ${chunked.totalItems}`,
      progress: `1/${chunked.totalChunks}`,
      nextStep: 'Call with continue=true for more children',
      operationId,
    });
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(analysis, {
    step: 'Frame details',
    progress: analysis.children ? `${analysis.children.length} direct children` : 'No children',
    nextStep: 'Use extract_styles for design tokens, or extract_assets for icons/images',
  });

  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}
