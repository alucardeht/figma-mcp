export async function searchComponents(ctx, fileKey, query, pageName, type, continueFlag = false) {
  const { session, chunker, figmaClient } = ctx;
  const operationId = `search_components:${fileKey}:${query}:${pageName || "all"}:${type || "all"}`;

  if (continueFlag && session.hasPendingChunks(operationId)) {
    const chunk = session.getNextChunk(operationId);
    const response = chunker.wrapResponse(
      { query, results: chunk.items },
      {
        step: `Showing results ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(chunk.chunkIndex * 20, chunk.totalItems)}`,
        progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
        nextStep: chunk.chunkIndex < chunk.totalChunks ? "Call with continue=true for more" : "Use get_frame_info on specific result",
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const file = await figmaClient.getFile(fileKey, 99);
  const lowerQuery = query.toLowerCase();
  const results = [];

  const searchNode = (node, pageNameLocal, path) => {
    if (type && node.type !== type) {
      if (node.children) {
        node.children.forEach((child) => searchNode(child, pageNameLocal, [...path, node.name]));
      }
      return;
    }

    if (node.name.toLowerCase().includes(lowerQuery)) {
      results.push({
        name: node.name,
        type: node.type,
        id: node.id,
        page: pageNameLocal,
        path: path.join(" > "),
        bounds: node.absoluteBoundingBox
          ? {
              width: Math.round(node.absoluteBoundingBox.width),
              height: Math.round(node.absoluteBoundingBox.height),
            }
          : null,
      });
    }

    if (node.children) {
      node.children.forEach((child) => searchNode(child, pageNameLocal, [...path, node.name]));
    }
  };

  const pages = pageName ? [figmaClient.findPageByName(file, pageName)].filter(Boolean) : file.document.children;

  pages.forEach((page) => {
    searchNode(page, page.name, []);
  });

  if (results.length > 20) {
    const chunked = chunker.chunkArray(results, operationId, 20);
    const pageNames = [...new Set(results.map((r) => r.page))];
    const types = [...new Set(results.map((r) => r.type))];

    const response = chunker.wrapResponse(
      { query, resultCount: results.length, results: chunked.items },
      {
        step: `Showing results 1-${chunked.items.length} of ${results.length}`,
        progress: `1/${chunked.totalChunks}`,
        nextStep: "Call with continue=true for more, or refine search",
        alert: `Found ${results.length} matches - showing first 20`,
        refinementOptions: [
          pageNames.length > 1 ? `Filter by page: ${pageNames.slice(0, 3).join(", ")}` : null,
          types.length > 1 ? `Filter by type: ${types.join(", ")}` : null,
          "Use more specific search term",
        ].filter(Boolean),
        operationId,
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(
    { query, resultCount: results.length, results },
    {
      step: "Search complete",
      progress: `${results.length} results`,
      nextStep: results.length > 0 ? "Use get_frame_info on a result for details" : "Try different search term",
    }
  );

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
