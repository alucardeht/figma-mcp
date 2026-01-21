import { countElements, analyzeFrame } from "../../utils/index.js";

export async function listPages(ctx, fileKey, continueFlag = false) {
  const { session, chunker, figmaClient } = ctx;
  const operationId = `list_pages:${fileKey}`;

  if (continueFlag && session.hasPendingChunks(operationId)) {
    const chunk = session.getNextChunk(operationId);
    const response = chunker.wrapResponse(
      { pages: chunk.items },
      {
        step: `Showing pages ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
        progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
        nextStep: chunk.chunkIndex < chunk.totalChunks ? "Call with continue=true for more" : "Use list_frames to explore a page",
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 1);

  const pages = file.document.children.map((page) => {
    session.markPageExplored(page.id);
    return {
      name: page.name,
      id: page.id,
      frameCount: page.children?.filter((c) => c.type === "FRAME" || c.type === "COMPONENT").length || 0,
    };
  });

  const chunked = chunker.chunkArray(pages, operationId, 20);

  if (chunked) {
    const response = chunker.wrapResponse(
      { file: file.name, lastModified: file.lastModified, pages: chunked.items },
      {
        step: `Showing pages 1-${chunked.items.length} of ${chunked.totalItems}`,
        progress: `1/${chunked.totalChunks}`,
        nextStep: "Call with continue=true for more pages, or use list_frames to explore",
        alert: `File has ${pages.length} pages - showing first ${chunked.items.length}`,
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(
    { file: file.name, lastModified: file.lastModified, pages },
    {
      step: "Listed all pages",
      progress: `${pages.length} pages`,
      nextStep: "Use list_frames(page_name) to explore frames in a page",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}

export async function listFrames(ctx, fileKey, pageName, continueFlag = false) {
  const { session, chunker, figmaClient } = ctx;
  const operationId = `list_frames:${fileKey}:${pageName}`;

  if (continueFlag && session.hasPendingChunks(operationId)) {
    const chunk = session.getNextChunk(operationId);
    const response = chunker.wrapResponse(
      { frames: chunk.items },
      {
        step: `Showing frames ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
        progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
        nextStep: chunk.chunkIndex < chunk.totalChunks ? "Call with continue=true for more" : "Use get_frame_info to detail a frame",
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  session.setCurrentFile(fileKey);
  const file = await figmaClient.getFile(fileKey, 2);
  const page = figmaClient.findPageByName(file, pageName);

  if (!page) {
    const available = file.document.children.map((p) => p.name).join(", ");
    throw new Error(`Page "${pageName}" not found. Available: ${available}`);
  }

  const frames = (page.children || [])
    .filter((c) => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET")
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
        nextStep: "Call with continue=true for more, or get_frame_info for details",
        alert: `Page has ${frames.length} frames - showing first ${chunked.items.length}`,
        strategy: "Review visible frames, continue if needed, then detail specific ones",
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(
    { page: page.name, frameCount: frames.length, frames },
    {
      step: "Listed all frames",
      progress: `${frames.length} frames`,
      nextStep: "Use get_frame_info(frame_name) for structure, or extract_assets for icons/images",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}

export async function getFrameInfo(ctx, fileKey, pageName, frameName, depth, continueFlag = false, nodeId = null) {
  const { session, chunker, figmaClient } = ctx;

  if (!nodeId && (!pageName || !frameName)) {
    throw new Error("Must provide either node_id OR both page_name and frame_name");
  }

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
          nextStep: chunk.chunkIndex < chunk.totalChunks ? "Call with continue=true for more" : "Use extract_styles or extract_assets",
          operationId,
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
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
          nextStep: chunk.chunkIndex < chunk.totalChunks ? "Call with continue=true for more" : "Use extract_styles or extract_assets",
          operationId,
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }

    session.setCurrentFile(fileKey);
    const file = await figmaClient.getFile(fileKey, 2);
    const page = figmaClient.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frameRef = figmaClient.findFrameByName(page, frameName);
    if (!frameRef) {
      const available = (page.children || [])
        .filter((c) => c.type === "FRAME" || c.type === "COMPONENT")
        .map((f) => f.name)
        .join(", ");
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
        warning: "Frame muito grande para processar diretamente",
        estimated_tokens: estimatedTokens,
        element_count: childCount,
        recommended_action: "Use analyze_page_structure primeiro ou reduza o escopo",
      },
      ctx
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  if (childCount > 1000) {
    const summary = analyzeFrame(frame, 1);
    const response = chunker.wrapResponse(summary, {
      step: "Frame summary (large frame detected)",
      progress: `~${childCount} elements`,
      nextStep: "Request specific child by name, or use depth=1 for top-level only",
      alert: `Frame has ~${childCount} elements - showing summary`,
      strategy: "Use depth=1 for overview, then drill into specific sections",
    });
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const analysis = analyzeFrame(frame, depth);

  if (analysis.children && analysis.children.length > 20) {
    const chunked = chunker.chunkArray(analysis.children, operationId, 20);
    const firstBatch = { ...analysis, children: chunked.items };

    const response = chunker.wrapResponse(firstBatch, {
      step: `Showing children 1-${chunked.items.length} of ${chunked.totalItems}`,
      progress: `1/${chunked.totalChunks}`,
      nextStep: "Call with continue=true for more children",
      operationId,
    });
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(analysis, {
    step: "Frame details",
    progress: analysis.children ? `${analysis.children.length} direct children` : "No children",
    nextStep: "Use extract_styles for design tokens, or extract_assets for icons/images",
  });

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
