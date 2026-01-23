import { z } from "zod";
import { countElements, analyzeFrame, resolveTarget } from "../../utils/index.js";

export const name = "figma_get";

export const description =
  "Universal Figma data retrieval with intelligent target resolution. Returns page list if no target specified. Supports fuzzy search, direct node access, flexible depth control, and deep element search with element_name parameter.";

export const inputSchema = {
  file_key: z.string().describe("Figma file key from URL"),
  node_id: z
    .string()
    .optional()
    .describe('Figma node ID (format: "40000056-28165") - fastest access'),
  page_name: z.string().optional().describe("Page name (partial match)"),
  frame_name: z.string().optional().describe("Frame name (partial match)"),
  query: z
    .string()
    .optional()
    .describe("Fuzzy search query across pages and frames"),
  depth: z
    .number()
    .optional()
    .describe("Traverse depth (1=direct, 2=grandchildren, 3=deep)")
    .default(2),
  include: z
    .array(z.enum(["children", "styles", "bounds", "summary"]))
    .optional()
    .describe("What to include in response"),
  continue: z
    .boolean()
    .optional()
    .describe("Continue from last chunked response"),
  element_name: z
    .string()
    .optional()
    .describe("Search for nested element by name within resolved frame (deep search)"),
};

export async function handler(args, ctx) {
  const { session, chunker, figmaClient } = ctx;
  const {
    file_key: fileKey,
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    query,
    depth = 2,
    include = ["children", "bounds"],
    continue: continueFlag = false,
    element_name: elementName,
  } = args;

  session.setCurrentFile(fileKey);

  if (continueFlag) {
    const operationId = `figma_get:${fileKey}`;
    if (session.hasPendingChunks(operationId)) {
      const chunk = session.getNextChunk(operationId);
      const response = chunker.wrapResponse(
        { items: chunk.items },
        {
          step: `Showing items ${(chunk.chunkIndex - 1) * 20 + 1}-${Math.min(
            chunk.chunkIndex * 20,
            chunk.totalItems
          )}`,
          progress: `${chunk.chunkIndex}/${chunk.totalChunks}`,
          nextStep:
            chunk.chunkIndex < chunk.totalChunks
              ? "Call with continue=true for more"
              : "Done",
          operationId,
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
  }

  // Use deeper fetch when frame_name specified to enable fallback deep search
  const fetchDepth = elementName ? 10 : (frameName ? 4 : 2);
  const file = await figmaClient.getFile(fileKey, fetchDepth);

  if (!nodeId && !pageName && !frameName && !query) {
    const pages = file.document.children.map((page) => {
      session.markPageExplored(page.id);
      return {
        name: page.name,
        id: page.id,
        frameCount: page.children?.filter(
          (c) => c.type === "FRAME" || c.type === "COMPONENT"
        ).length || 0,
      };
    });

    const chunked = chunker.chunkArray(pages, `figma_get:${fileKey}`, 20);

    if (chunked) {
      const response = chunker.wrapResponse(
        {
          file: file.name,
          type: "pages_list",
          pages: chunked.items,
        },
        {
          step: `Showing pages 1-${chunked.items.length} of ${chunked.totalItems}`,
          progress: `1/${chunked.totalChunks}`,
          nextStep:
            chunked.totalChunks > 1
              ? "Call with continue=true for more pages"
              : "Specify a page_name or frame_name to drill down",
          operationId: `figma_get:${fileKey}`,
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }

    const response = chunker.wrapResponse(
      {
        file: file.name,
        type: "pages_list",
        pages,
      },
      {
        step: `Listed all ${pages.length} pages`,
        nextStep:
          pages.length > 0
            ? "Use page_name parameter to explore a specific page"
            : "No pages found in file",
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const resolution = resolveTarget(file, {
    node_id: nodeId,
    page_name: pageName,
    frame_name: frameName,
    query,
    element_name: elementName,
  });

  if (!resolution.success) {
    const errorResponse = {
      error: resolution.error,
      errorType: resolution.errorType,
      suggestions: resolution.suggestions,
      candidates: resolution.candidates,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(errorResponse, null, 2) }],
    };
  }

  let targetNode = null;

  if (resolution.type === "page") {
    targetNode = file.document.children.find((p) => p.id === resolution.target.id);
  } else if (resolution.type === "frame") {
    const page = file.document.children.find(
      (p) => p.id === resolution.page.id
    );
    if (page) {
      function findNode(node, id) {
        if (node.id === id) return node;
        if (!node.children) return null;
        for (const child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
        return null;
      }
      targetNode = findNode(page, resolution.target.id);
    }
  } else if (resolution.type === "node") {
    const page = file.document.children.find(
      (p) => p.id === resolution.page.id
    );
    if (page) {
      function findNode(node, id) {
        if (node.id === id) return node;
        if (!node.children) return null;
        for (const child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
        return null;
      }
      targetNode = findNode(page, resolution.target.id);
    }
  } else if (resolution.type === "element") {
    const page = file.document.children.find(
      (p) => p.id === resolution.page.id
    );
    if (page) {
      function findNode(node, id) {
        if (node.id === id) return node;
        if (!node.children) return null;
        for (const child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
        return null;
      }
      targetNode = findNode(page, resolution.target.id);
    }
  }

  if (!targetNode) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "Target node not found after resolution",
              errorType: "not_found",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const elementCount = countElements(targetNode);

  if (elementCount > 1000 && depth > 1) {
    const summary = analyzeFrame(targetNode, 1);
    const response = chunker.wrapResponse(summary, {
      step: "Target summary (large element detected)",
      alert: `Target has ~${elementCount} elements - showing overview only`,
      recommendation: "Use depth=1 for overview, then specify child by name",
    });
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const analysis = analyzeFrame(targetNode, depth);

  if (include.includes("summary") && !include.includes("children")) {
    const response = chunker.wrapResponse(analysis, {
      step: "Target summary",
      info: `${elementCount} total elements`,
    });
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  if (analysis.children && analysis.children.length > 20) {
    const operationId = `figma_get:${fileKey}:${resolution.target.id}`;
    const chunked = chunker.chunkArray(
      analysis.children,
      operationId,
      20
    );
    const firstBatch = { ...analysis, children: chunked.items };

    const response = chunker.wrapResponse(firstBatch, {
      step: `Showing children 1-${chunked.items.length} of ${chunked.totalItems}`,
      progress: `1/${chunked.totalChunks}`,
      nextStep:
        chunked.totalChunks > 1
          ? "Call with continue=true for more"
          : "Done",
      operationId,
    });
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  const response = chunker.wrapResponse(analysis, {
    step: "Target details retrieved",
    path: resolution.path,
    info: `${elementCount} total elements`,
  });

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
