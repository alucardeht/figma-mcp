#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import sharp from "sharp";
import { writeFile, mkdir, readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;
const FIGMA_API_BASE = "https://api.figma.com/v1";

const TIER_LIMITS = {
  1: { requests: 10, window: 60000 },
  2: { requests: 25, window: 60000 },
  3: { requests: 50, window: 60000 },
};

class RateLimiter {
  constructor() {
    this.buckets = { 1: [], 2: [], 3: [] };
  }

  async waitForSlot(tier) {
    const limit = TIER_LIMITS[tier];
    const now = Date.now();
    this.buckets[tier] = this.buckets[tier].filter(t => now - t < limit.window);

    if (this.buckets[tier].length >= limit.requests) {
      const oldestRequest = this.buckets[tier][0];
      const waitTime = limit.window - (now - oldestRequest) + 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForSlot(tier);
    }

    this.buckets[tier].push(now);
    return true;
  }
}

class TokenEstimator {
  static LIMITS = { DEFAULT: 4000, HARD: 5000, SUMMARY: 500 };

  estimate(obj) {
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return Math.ceil(str.length / 4);
  }

  willExceed(obj, limit = TokenEstimator.LIMITS.DEFAULT) {
    return this.estimate(obj) > limit;
  }
}

class SessionManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentFile = null;
    this.exploredPages = new Set();
    this.exploredFrames = new Set();
    this.pendingChunks = new Map();
    this.lastResponse = null;
    this.lastUpdated = Date.now();
  }

  setCurrentFile(fileKey) {
    if (this.currentFile !== fileKey) {
      this.currentFile = fileKey;
      this.exploredPages.clear();
      this.exploredFrames.clear();
    }
    this.lastUpdated = Date.now();
  }

  markPageExplored(pageId) {
    this.exploredPages.add(pageId);
    this.lastUpdated = Date.now();
  }

  markFrameExplored(frameId) {
    this.exploredFrames.add(frameId);
    this.lastUpdated = Date.now();
  }

  storePendingChunks(operationId, chunks) {
    this.pendingChunks.set(operationId, { chunks, currentIndex: 0 });
    this.lastUpdated = Date.now();
  }

  getNextChunk(operationId) {
    const pending = this.pendingChunks.get(operationId);
    if (!pending || pending.currentIndex >= pending.chunks.length) {
      return null;
    }
    const chunk = pending.chunks[pending.currentIndex];
    pending.currentIndex++;
    if (pending.currentIndex >= pending.chunks.length) {
      this.pendingChunks.delete(operationId);
    }
    this.lastUpdated = Date.now();
    return chunk;
  }

  hasPendingChunks(operationId) {
    const pending = this.pendingChunks.get(operationId);
    return pending && pending.currentIndex < pending.chunks.length;
  }

  storeLastResponse(response) {
    this.lastResponse = response;
    this.lastUpdated = Date.now();
  }

  getLastResponse() {
    return this.lastResponse;
  }

  getState() {
    return {
      currentFile: this.currentFile,
      exploredPages: [...this.exploredPages],
      exploredFrames: [...this.exploredFrames],
      pendingOperations: [...this.pendingChunks.keys()],
      hasLastResponse: !!this.lastResponse,
      lastUpdated: new Date(this.lastUpdated).toISOString(),
    };
  }
}

class ResponseChunker {
  constructor(tokenEstimator, sessionManager) {
    this.tokenEstimator = tokenEstimator;
    this.session = sessionManager;
  }

  wrapResponse(data, options = {}) {
    const {
      step = "Operation completed",
      progress = "1/1",
      nextStep = null,
      alert = null,
      strategy = null,
      refinementOptions = null,
      operationId = null,
    } = options;

    const response = {
      _navigation: {
        currentStep: step,
        progress,
        tokensThisResponse: 0,
        canContinue: false,
      },
      data,
    };

    if (nextStep) {
      response._navigation.nextStep = nextStep;
    }

    if (alert || strategy || refinementOptions) {
      response._guidance = {};
      if (alert) response._guidance.alert = alert;
      if (strategy) response._guidance.strategy = strategy;
      if (refinementOptions) response._guidance.refinementOptions = refinementOptions;
    }

    response._navigation.tokensThisResponse = this.tokenEstimator.estimate(response);

    if (operationId && this.session.hasPendingChunks(operationId)) {
      response._navigation.canContinue = true;
    }

    return response;
  }

  chunkArray(array, operationId, maxItemsPerChunk = 20) {
    if (array.length <= maxItemsPerChunk) {
      return null;
    }

    const chunks = [];
    for (let i = 0; i < array.length; i += maxItemsPerChunk) {
      chunks.push({
        items: array.slice(i, i + maxItemsPerChunk),
        chunkIndex: Math.floor(i / maxItemsPerChunk) + 1,
        totalChunks: Math.ceil(array.length / maxItemsPerChunk),
        totalItems: array.length,
      });
    }

    this.session.storePendingChunks(operationId, chunks.slice(1));
    return chunks[0];
  }
}

class FigmaMCPServer {
  constructor() {
    this.server = new Server(
      { name: "figma-mcp-server", version: "3.0.0" },
      { capabilities: { tools: {} } }
    );
    this.rateLimiter = new RateLimiter();
    this.cache = new Map();
    this.tokenEstimator = new TokenEstimator();
    this.session = new SessionManager();
    this.chunker = new ResponseChunker(this.tokenEstimator, this.session);
    this.setupHandlers();
  }

  async figmaRequest(endpoint, params = {}, tier = 1) {
    await this.rateLimiter.waitForSlot(tier);

    const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await axios.get(`${FIGMA_API_BASE}${endpoint}`, {
        params,
        headers: { "X-Figma-Token": FIGMA_API_TOKEN },
      });
      this.cache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers["retry-after"] || "60", 10);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.figmaRequest(endpoint, params, tier);
      }
      throw error;
    }
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_pages",
          description: `List all pages in a Figma file.

HOW IT WORKS:
- Returns compact JSON with page names, IDs, and frame counts
- Large files (>50 pages) are automatically chunked
- Use 'continue: true' to get next batch

TYPICAL WORKFLOW:
1. list_pages → see all pages
2. list_frames(page_name) → see frames in a page
3. get_frame_info(frame_name) → detail one frame`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: {
                type: "string",
                description: "Figma file key from URL (e.g., 'h75vgHNcwxfHkRBbI53RRu')",
              },
              continue: {
                type: "boolean",
                description: "Continue from last response if more pages available",
              },
            },
            required: ["file_key"],
          },
        },
        {
          name: "list_frames",
          description: `List frames/screens in a specific page.

HOW IT WORKS:
- Search by page name (partial match supported)
- Large pages (>50 frames) are automatically chunked
- Returns compact list with frame names, sizes, and IDs
- Session remembers what was sent

TYPICAL WORKFLOW:
1. list_pages → find page name
2. list_frames(page_name) → see frames
3. get_frame_info(frame_name) → detail one frame
4. extract_assets(frame_name) → get assets`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match, case-insensitive)" },
              continue: { type: "boolean", description: "Continue from last response if more frames available" },
            },
            required: ["file_key", "page_name"],
          },
        },
        {
          name: "get_frame_info",
          description: `Get detailed info about a specific frame.

HOW IT WORKS:
- Returns all components, text, colors, and styles
- Large frames (>1000 elements) trigger warning with strategy
- Use depth parameter to control detail level
- Automatically chunks if response too large

TYPICAL WORKFLOW:
1. list_frames → find frame name
2. get_frame_info(frame_name) → structure
3. extract_styles → design tokens
4. extract_assets → icons/images`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match)" },
              frame_name: { type: "string", description: "Frame name (partial match)" },
              depth: { type: "number", description: "How deep to traverse (1=direct children, 2=grandchildren). Default: 2", default: 2 },
              continue: { type: "boolean", description: "Continue from last response" },
            },
            required: ["file_key", "page_name", "frame_name"],
          },
        },
        {
          name: "get_screenshot",
          description: `Capture screenshot of a frame.

HOW IT WORKS:
- For large frames, automatically segments into tiles
- Returns base64 image(s)
- Scale 1-4 controls resolution

TYPICAL WORKFLOW:
1. list_frames → find frame
2. get_screenshot → visual reference
3. get_frame_info → structure details`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match)" },
              frame_name: { type: "string", description: "Frame name (partial match)" },
              scale: { type: "number", description: "Scale 1-4 (default: 2)", default: 2 },
              max_dimension: { type: "number", description: "Max px before segmenting (default: 4096)", default: 4096 },
            },
            required: ["file_key", "page_name", "frame_name"],
          },
        },
        {
          name: "extract_styles",
          description: `Extract all design tokens from a frame.

HOW IT WORKS:
- Collects colors, fonts, spacing, border radius, shadows
- Returns organized JSON ready for CSS/theme generation
- No chunking needed (compact output)

TYPICAL WORKFLOW:
1. get_frame_info → understand structure
2. extract_styles → design tokens
3. Use tokens to build theme/CSS`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match)" },
              frame_name: { type: "string", description: "Frame name (partial match)" },
            },
            required: ["file_key", "page_name", "frame_name"],
          },
        },
        {
          name: "extract_assets",
          description: `Extract all assets from a frame with progress tracking.

HOW IT WORKS:
- Automatically categorizes into icons/ and images/
- Uses smart naming based on component hierarchy
- Shows progress: "Processing batch 1/5 - found 8 icons, 3 images"
- Final summary with all file paths

TYPICAL WORKFLOW:
1. get_frame_info → see what assets exist
2. extract_assets → download all
3. Check summary for file paths`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match)" },
              frame_name: { type: "string", description: "Frame name (partial match)" },
              output_dir: { type: "string", description: "Output directory (default: ./figma-assets)", default: "./figma-assets" },
            },
            required: ["file_key", "page_name", "frame_name"],
          },
        },
        {
          name: "search_components",
          description: `Search for components by name across the file.

HOW IT WORKS:
- Searches entire file or specific page
- Returns top 20 results with total count
- If >20 results, suggests refinement options
- Use 'continue: true' to get more results

TYPICAL WORKFLOW:
1. search_components(query) → find matches
2. If too many: refine with page_name or type filter
3. get_frame_info on specific result`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              query: { type: "string", description: "Search term (case-insensitive, partial match)" },
              page_name: { type: "string", description: "Limit search to specific page" },
              type: { type: "string", description: "Filter by type: COMPONENT, INSTANCE, FRAME, TEXT, VECTOR" },
              continue: { type: "boolean", description: "Continue from last response for more results" },
            },
            required: ["file_key", "query"],
          },
        },
        {
          name: "get_file_styles",
          description: `Get all published styles defined in the file.

HOW IT WORKS:
- Returns design system tokens: colors, text styles, effects
- These are the official styles defined in Figma
- Compact output, no chunking needed

TYPICAL WORKFLOW:
1. get_file_styles → global design tokens
2. extract_styles(frame) → frame-specific tokens
3. Combine for complete design system`,
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
            },
            required: ["file_key"],
          },
        },
        {
          name: "repeat_last",
          description: `Repeat the last response without making new API calls.

HOW IT WORKS:
- Returns exact same response from session state
- No Figma API call needed
- Useful for context recovery

WHEN TO USE:
- Lost context and need to see previous data
- Want to reference last response again`,
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_session_state",
          description: `Get current session state for debugging.

RETURNS:
- Current file being explored
- Pages and frames already sent
- Pending continuation operations
- Last update timestamp`,
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "reset_session",
          description: `Clear all session state for fresh start.

USE WHEN:
- Switching to different Figma file
- Want to re-explore from scratch
- Session state seems corrupted`,
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!FIGMA_API_TOKEN && !["repeat_last", "get_session_state", "reset_session"].includes(name)) {
        throw new Error("FIGMA_API_TOKEN not set. Export it or add to your MCP config.");
      }

      try {
        let result;
        switch (name) {
          case "list_pages": result = await this.listPages(args.file_key, args.continue); break;
          case "list_frames": result = await this.listFrames(args.file_key, args.page_name, args.continue); break;
          case "get_frame_info": result = await this.getFrameInfo(args.file_key, args.page_name, args.frame_name, args.depth || 2, args.continue); break;
          case "get_screenshot": result = await this.getScreenshot(args.file_key, args.page_name, args.frame_name, args.scale || 2, args.max_dimension || 4096); break;
          case "extract_styles": result = await this.extractStyles(args.file_key, args.page_name, args.frame_name); break;
          case "extract_assets": result = await this.extractAssets(args.file_key, args.page_name, args.frame_name, args.output_dir || "./figma-assets"); break;
          case "search_components": result = await this.searchComponents(args.file_key, args.query, args.page_name, args.type, args.continue); break;
          case "get_file_styles": result = await this.getFileStyles(args.file_key); break;
          case "repeat_last": result = this.repeatLast(); break;
          case "get_session_state": result = this.getSessionState(); break;
          case "reset_session": result = this.resetSession(); break;
          default: throw new Error(`Unknown tool: ${name}`);
        }

        this.session.storeLastResponse(result);
        return result;
      } catch (error) {
        const errorResponse = {
          content: [{
            type: "text",
            text: JSON.stringify(this.chunker.wrapResponse(
              { error: error.message },
              { step: "Error", nextStep: "Check parameters and try again" }
            ), null, 2),
          }],
        };
        return errorResponse;
      }
    });
  }

  async getFileData(fileKey, depth = 1) {
    this.session.setCurrentFile(fileKey);
    return await this.figmaRequest(`/files/${fileKey}`, { depth }, 1);
  }

  async getNodeData(fileKey, nodeId) {
    const data = await this.figmaRequest(`/files/${fileKey}/nodes`, { ids: nodeId }, 1);
    return data.nodes[nodeId]?.document;
  }

  findPageByName(file, pageName) {
    const lowerName = pageName.toLowerCase();
    return file.document.children.find(p =>
      p.name.toLowerCase().includes(lowerName)
    );
  }

  findFrameByName(page, frameName) {
    const lowerName = frameName.toLowerCase();
    const findInChildren = (children) => {
      for (const child of children) {
        if ((child.type === "FRAME" || child.type === "COMPONENT" || child.type === "COMPONENT_SET") &&
            child.name.toLowerCase().includes(lowerName)) {
          return child;
        }
        if (child.children) {
          const found = findInChildren(child.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findInChildren(page.children || []);
  }

  async listPages(fileKey, continueFlag = false) {
    const operationId = `list_pages:${fileKey}`;

    if (continueFlag && this.session.hasPendingChunks(operationId)) {
      const chunk = this.session.getNextChunk(operationId);
      const response = this.chunker.wrapResponse(
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

    const file = await this.getFileData(fileKey, 1);

    const pages = file.document.children.map(page => {
      this.session.markPageExplored(page.id);
      return {
        name: page.name,
        id: page.id,
        frameCount: page.children?.filter(c =>
          c.type === "FRAME" || c.type === "COMPONENT"
        ).length || 0,
      };
    });

    const chunked = this.chunker.chunkArray(pages, operationId, 20);

    if (chunked) {
      const response = this.chunker.wrapResponse(
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

    const response = this.chunker.wrapResponse(
      { file: file.name, lastModified: file.lastModified, pages },
      {
        step: "Listed all pages",
        progress: `${pages.length} pages`,
        nextStep: "Use list_frames(page_name) to explore frames in a page",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  async listFrames(fileKey, pageName, continueFlag = false) {
    const operationId = `list_frames:${fileKey}:${pageName}`;

    if (continueFlag && this.session.hasPendingChunks(operationId)) {
      const chunk = this.session.getNextChunk(operationId);
      const response = this.chunker.wrapResponse(
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

    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);

    if (!page) {
      const available = file.document.children.map(p => p.name).join(", ");
      throw new Error(`Page "${pageName}" not found. Available: ${available}`);
    }

    const frames = (page.children || [])
      .filter(c => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET")
      .map(f => {
        this.session.markFrameExplored(f.id);
        return {
          name: f.name,
          id: f.id,
          type: f.type,
          width: Math.round(f.absoluteBoundingBox?.width || 0),
          height: Math.round(f.absoluteBoundingBox?.height || 0),
          childCount: f.children?.length || 0,
        };
      });

    const chunked = this.chunker.chunkArray(frames, operationId, 20);

    if (chunked) {
      const response = this.chunker.wrapResponse(
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

    const response = this.chunker.wrapResponse(
      { page: page.name, frameCount: frames.length, frames },
      {
        step: "Listed all frames",
        progress: `${frames.length} frames`,
        nextStep: "Use get_frame_info(frame_name) for structure, or extract_assets for icons/images",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  async getFrameInfo(fileKey, pageName, frameName, depth, continueFlag = false) {
    const operationId = `get_frame_info:${fileKey}:${pageName}:${frameName}`;

    if (continueFlag && this.session.hasPendingChunks(operationId)) {
      const chunk = this.session.getNextChunk(operationId);
      const response = this.chunker.wrapResponse(
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

    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frameRef = this.findFrameByName(page, frameName);
    if (!frameRef) {
      const available = (page.children || [])
        .filter(c => c.type === "FRAME" || c.type === "COMPONENT")
        .map(f => f.name)
        .join(", ");
      throw new Error(`Frame "${frameName}" not found. Available: ${available}`);
    }

    const frame = await this.getNodeData(fileKey, frameRef.id);
    const childCount = this.countElements(frame);

    if (childCount > 1000) {
      const summary = this.analyzeFrame(frame, 1);
      const response = this.chunker.wrapResponse(
        summary,
        {
          step: "Frame summary (large frame detected)",
          progress: `~${childCount} elements`,
          nextStep: "Request specific child by name, or use depth=1 for top-level only",
          alert: `Frame has ~${childCount} elements - showing summary`,
          strategy: "Use depth=1 for overview, then drill into specific sections",
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }

    const analysis = this.analyzeFrame(frame, depth);

    if (analysis.children && analysis.children.length > 20) {
      const chunked = this.chunker.chunkArray(analysis.children, operationId, 20);
      const firstBatch = { ...analysis, children: chunked.items };

      const response = this.chunker.wrapResponse(
        firstBatch,
        {
          step: `Showing children 1-${chunked.items.length} of ${chunked.totalItems}`,
          progress: `1/${chunked.totalChunks}`,
          nextStep: "Call with continue=true for more children",
          operationId,
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }

    const response = this.chunker.wrapResponse(
      analysis,
      {
        step: "Frame details",
        progress: analysis.children ? `${analysis.children.length} direct children` : "No children",
        nextStep: "Use extract_styles for design tokens, or extract_assets for icons/images",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  countElements(node) {
    if (!node) return 0;
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += this.countElements(child);
      }
    }
    return count;
  }

  analyzeFrame(node, depth, currentDepth = 0) {
    if (!node) return null;

    const result = {
      name: node.name,
      type: node.type,
      id: node.id,
    };

    if (node.absoluteBoundingBox) {
      result.bounds = {
        x: Math.round(node.absoluteBoundingBox.x),
        y: Math.round(node.absoluteBoundingBox.y),
        width: Math.round(node.absoluteBoundingBox.width),
        height: Math.round(node.absoluteBoundingBox.height),
      };
    }

    if (node.type === "TEXT") {
      result.text = node.characters;
      if (node.style) {
        result.textStyle = {
          fontFamily: node.style.fontFamily,
          fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight,
          lineHeight: node.style.lineHeightPx,
          letterSpacing: node.style.letterSpacing,
        };
      }
    }

    if (node.fills?.length > 0) {
      result.fills = node.fills
        .filter(f => f.visible !== false)
        .map(f => this.extractFillInfo(f));
    }

    if (node.strokes?.length > 0) {
      result.strokes = node.strokes.map(s => ({
        color: this.colorToHex(s.color),
        weight: node.strokeWeight,
      }));
    }

    if (node.effects?.length > 0) {
      result.effects = node.effects.map(e => ({
        type: e.type,
        radius: e.radius,
        color: e.color ? this.colorToHex(e.color) : null,
        offset: e.offset,
      }));
    }

    if (node.cornerRadius) {
      result.cornerRadius = node.cornerRadius;
    }

    if (node.paddingLeft || node.paddingTop || node.paddingRight || node.paddingBottom) {
      result.padding = {
        top: node.paddingTop || 0,
        right: node.paddingRight || 0,
        bottom: node.paddingBottom || 0,
        left: node.paddingLeft || 0,
      };
    }

    if (node.itemSpacing) {
      result.gap = node.itemSpacing;
    }

    if (node.layoutMode) {
      result.layout = {
        mode: node.layoutMode,
        align: node.primaryAxisAlignItems,
        crossAlign: node.counterAxisAlignItems,
      };
    }

    if (currentDepth < depth && node.children?.length > 0) {
      result.children = node.children.map(child =>
        this.analyzeFrame(child, depth, currentDepth + 1)
      );
    } else if (node.children?.length > 0) {
      result.childCount = node.children.length;
    }

    return result;
  }

  extractFillInfo(fill) {
    if (fill.type === "SOLID") {
      return {
        type: "solid",
        color: this.colorToHex(fill.color),
        opacity: fill.opacity,
      };
    }
    if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") {
      return {
        type: fill.type.toLowerCase().replace("gradient_", ""),
        stops: fill.gradientStops?.map(s => ({
          color: this.colorToHex(s.color),
          position: s.position,
        })),
      };
    }
    if (fill.type === "IMAGE") {
      return { type: "image", imageRef: fill.imageRef };
    }
    return { type: fill.type };
  }

  colorToHex(color) {
    if (!color) return null;
    const r = Math.round((color.r || 0) * 255);
    const g = Math.round((color.g || 0) * 255);
    const b = Math.round((color.b || 0) * 255);
    const a = color.a !== undefined ? color.a : 1;

    if (a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  async getScreenshot(fileKey, pageName, frameName, scale, maxDimension) {
    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frame = this.findFrameByName(page, frameName);
    if (!frame) throw new Error(`Frame "${frameName}" not found`);

    const width = (frame.absoluteBoundingBox?.width || 0) * scale;
    const height = (frame.absoluteBoundingBox?.height || 0) * scale;

    const imageData = await this.figmaRequest("/images/" + fileKey, {
      ids: frame.id,
      scale,
      format: "png",
    }, 1);

    const imageUrl = imageData.images[frame.id];
    if (!imageUrl) throw new Error("Failed to generate image");

    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

    if (width > maxDimension || height > maxDimension) {
      const tiles = await this.segmentImage(response.data, width, height, maxDimension);

      const navInfo = this.chunker.wrapResponse(
        { frame: frame.name, width: Math.round(width), height: Math.round(height), tiles: tiles.length },
        {
          step: `Screenshot segmented into ${tiles.length} tiles`,
          progress: "Complete",
          nextStep: "Use get_frame_info for structure details",
        }
      );

      return {
        content: [
          { type: "text", text: JSON.stringify(navInfo, null, 2) },
          ...tiles.map((tile) => ({
            type: "image",
            data: tile.data,
            mimeType: "image/png",
          })),
        ],
      };
    }

    const navInfo = this.chunker.wrapResponse(
      { frame: frame.name, width: Math.round(width), height: Math.round(height) },
      {
        step: "Screenshot captured",
        progress: "Complete",
        nextStep: "Use get_frame_info for structure, or extract_assets for icons/images",
      }
    );

    return {
      content: [
        { type: "text", text: JSON.stringify(navInfo, null, 2) },
        {
          type: "image",
          data: Buffer.from(response.data).toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  }

  async segmentImage(buffer, width, height, maxDimension) {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const cols = Math.ceil(metadata.width / maxDimension);
    const rows = Math.ceil(metadata.height / maxDimension);
    const tileWidth = Math.ceil(metadata.width / cols);
    const tileHeight = Math.ceil(metadata.height / rows);

    const tiles = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const left = col * tileWidth;
        const top = row * tileHeight;
        const extractWidth = Math.min(tileWidth, metadata.width - left);
        const extractHeight = Math.min(tileHeight, metadata.height - top);

        const tile = await sharp(buffer)
          .extract({ left, top, width: extractWidth, height: extractHeight })
          .png()
          .toBuffer();

        tiles.push({
          row,
          col,
          data: tile.toString("base64"),
        });
      }
    }

    return tiles;
  }

  async extractStyles(fileKey, pageName, frameName) {
    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frameRef = this.findFrameByName(page, frameName);
    if (!frameRef) throw new Error(`Frame "${frameName}" not found`);

    const frame = await this.getNodeData(fileKey, frameRef.id);

    const styles = {
      colors: new Set(),
      fonts: new Set(),
      fontSizes: new Set(),
      borderRadii: new Set(),
      spacing: new Set(),
      shadows: [],
    };

    this.collectStyles(frame, styles);

    const response = this.chunker.wrapResponse(
      {
        frame: frame.name,
        designTokens: {
          colors: [...styles.colors].sort(),
          fonts: [...styles.fonts].sort(),
          fontSizes: [...styles.fontSizes].sort((a, b) => a - b),
          borderRadii: [...styles.borderRadii].sort((a, b) => a - b),
          spacing: [...styles.spacing].sort((a, b) => a - b),
          shadows: styles.shadows,
        },
      },
      {
        step: "Design tokens extracted",
        progress: `${styles.colors.size} colors, ${styles.fonts.size} fonts`,
        nextStep: "Use these tokens to build your theme/CSS, or extract_assets for icons/images",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  collectStyles(node, styles) {
    if (!node) return;

    if (node.fills) {
      node.fills.forEach(fill => {
        if (fill.type === "SOLID" && fill.color) {
          styles.colors.add(this.colorToHex(fill.color));
        }
      });
    }

    if (node.strokes) {
      node.strokes.forEach(stroke => {
        if (stroke.color) {
          styles.colors.add(this.colorToHex(stroke.color));
        }
      });
    }

    if (node.style) {
      if (node.style.fontFamily) styles.fonts.add(node.style.fontFamily);
      if (node.style.fontSize) styles.fontSizes.add(node.style.fontSize);
    }

    if (node.cornerRadius) styles.borderRadii.add(node.cornerRadius);
    if (node.paddingTop) styles.spacing.add(node.paddingTop);
    if (node.paddingRight) styles.spacing.add(node.paddingRight);
    if (node.paddingBottom) styles.spacing.add(node.paddingBottom);
    if (node.paddingLeft) styles.spacing.add(node.paddingLeft);
    if (node.itemSpacing) styles.spacing.add(node.itemSpacing);

    if (node.effects) {
      node.effects.forEach(effect => {
        if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
          const shadow = {
            type: effect.type,
            color: effect.color ? this.colorToHex(effect.color) : null,
            offset: effect.offset,
            radius: effect.radius,
            spread: effect.spread,
          };
          if (!styles.shadows.some(s => JSON.stringify(s) === JSON.stringify(shadow))) {
            styles.shadows.push(shadow);
          }
        }
      });
    }

    if (node.children) {
      node.children.forEach(child => this.collectStyles(child, styles));
    }
  }

  async extractAssets(fileKey, pageName, frameName, outputDir) {
    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);

    const frameRef = this.findFrameByName(page, frameName);
    if (!frameRef) throw new Error(`Frame "${frameName}" not found`);

    const frame = await this.getNodeData(fileKey, frameRef.id);
    const assets = this.findAssets(frame, []);

    const iconsDir = join(outputDir, "icons");
    const imagesDir = join(outputDir, "images");
    await mkdir(iconsDir, { recursive: true });
    await mkdir(imagesDir, { recursive: true });

    const results = { icons: [], images: [], failed: [] };
    const batchSize = 10;
    const totalBatches = Math.ceil(assets.length / batchSize);

    for (let i = 0; i < assets.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = assets.slice(i, i + batchSize);
      const ids = batch.map(a => a.id).join(",");

      try {
        const svgData = await this.figmaRequest("/images/" + fileKey, {
          ids,
          format: "svg",
        }, 1);

        const pngData = await this.figmaRequest("/images/" + fileKey, {
          ids,
          format: "png",
          scale: 2,
        }, 1);

        for (const asset of batch) {
          const safeName = asset.name
            .replace(/[^a-z0-9]/gi, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase() || "asset";

          try {
            if (asset.category === "icon" && svgData.images[asset.id]) {
              const svgResponse = await axios.get(svgData.images[asset.id]);
              const filePath = join(iconsDir, `${safeName}.svg`);
              await writeFile(filePath, svgResponse.data);
              results.icons.push({ name: safeName, path: filePath });
            } else if (pngData.images[asset.id]) {
              const pngResponse = await axios.get(pngData.images[asset.id], { responseType: "arraybuffer" });
              const filePath = join(imagesDir, `${safeName}.png`);
              await writeFile(filePath, Buffer.from(pngResponse.data));
              results.images.push({ name: safeName, path: filePath });
            }
          } catch (err) {
            results.failed.push({ name: safeName, error: err.message });
          }
        }
      } catch (err) {
        batch.forEach(a => results.failed.push({ name: a.name, error: err.message }));
      }
    }

    const response = this.chunker.wrapResponse(
      {
        frame: frame.name,
        outputDir,
        _progress: {
          batchesProcessed: totalBatches,
          totalBatches,
          assetsFound: { icons: results.icons.length, images: results.images.length },
        },
        summary: {
          icons: results.icons.length,
          images: results.images.length,
          failed: results.failed.length,
        },
        icons: results.icons.map(i => i.path),
        images: results.images.map(i => i.path),
        failed: results.failed,
      },
      {
        step: "Asset extraction complete",
        progress: `${results.icons.length} icons, ${results.images.length} images`,
        nextStep: "Assets saved to disk. Use extract_styles for design tokens.",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  findAssets(node, path) {
    if (!node) return [];

    const assets = [];
    const currentPath = [...path, node.name];

    const isIcon = this.isIconNode(node);
    const isImage = this.isImageNode(node);

    if (isIcon || isImage) {
      assets.push({
        id: node.id,
        name: this.buildAssetName(currentPath),
        category: isIcon ? "icon" : "image",
        type: node.type,
      });
    }

    if (node.children && !isIcon && !isImage) {
      node.children.forEach(child => {
        assets.push(...this.findAssets(child, currentPath));
      });
    }

    return assets;
  }

  isIconNode(node) {
    const name = node.name.toLowerCase();
    const hasIconKeyword = name.includes("icon") || name.includes("ico") ||
                          name.includes("logo") || name.includes("symbol") ||
                          name.includes("arrow") || name.includes("chevron");
    const isVectorType = node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION";
    const isSmall = node.absoluteBoundingBox &&
                   node.absoluteBoundingBox.width <= 64 &&
                   node.absoluteBoundingBox.height <= 64;

    return hasIconKeyword || (isVectorType && isSmall);
  }

  isImageNode(node) {
    const hasImageFill = node.fills?.some(f => f.type === "IMAGE");
    const name = node.name.toLowerCase();
    const hasImageKeyword = name.includes("image") || name.includes("photo") ||
                           name.includes("img") || name.includes("picture") ||
                           name.includes("banner") || name.includes("hero") ||
                           name.includes("background") || name.includes("bg");

    return hasImageFill || (node.type === "RECTANGLE" && hasImageKeyword);
  }

  buildAssetName(path) {
    const relevant = path.filter(p =>
      !p.toLowerCase().startsWith("frame") &&
      !p.toLowerCase().startsWith("group") &&
      p.length > 1
    );
    return relevant.slice(-2).join("-");
  }

  async searchComponents(fileKey, query, pageName, type, continueFlag = false) {
    const operationId = `search_components:${fileKey}:${query}:${pageName || "all"}:${type || "all"}`;

    if (continueFlag && this.session.hasPendingChunks(operationId)) {
      const chunk = this.session.getNextChunk(operationId);
      const response = this.chunker.wrapResponse(
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

    const file = await this.getFileData(fileKey, 99);
    const lowerQuery = query.toLowerCase();
    const results = [];

    const searchNode = (node, pageName, path) => {
      if (type && node.type !== type) {
        if (node.children) {
          node.children.forEach(child => searchNode(child, pageName, [...path, node.name]));
        }
        return;
      }

      if (node.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: node.name,
          type: node.type,
          id: node.id,
          page: pageName,
          path: path.join(" > "),
          bounds: node.absoluteBoundingBox ? {
            width: Math.round(node.absoluteBoundingBox.width),
            height: Math.round(node.absoluteBoundingBox.height),
          } : null,
        });
      }

      if (node.children) {
        node.children.forEach(child => searchNode(child, pageName, [...path, node.name]));
      }
    };

    const pages = pageName
      ? [this.findPageByName(file, pageName)].filter(Boolean)
      : file.document.children;

    pages.forEach(page => {
      searchNode(page, page.name, []);
    });

    if (results.length > 20) {
      const chunked = this.chunker.chunkArray(results, operationId, 20);
      const pageNames = [...new Set(results.map(r => r.page))];
      const types = [...new Set(results.map(r => r.type))];

      const response = this.chunker.wrapResponse(
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

    const response = this.chunker.wrapResponse(
      { query, resultCount: results.length, results },
      {
        step: "Search complete",
        progress: `${results.length} results`,
        nextStep: results.length > 0 ? "Use get_frame_info on a result for details" : "Try different search term",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  async getFileStyles(fileKey) {
    const styles = await this.figmaRequest(`/files/${fileKey}/styles`, {}, 2);

    const organized = {
      colors: [],
      text: [],
      effects: [],
      grids: [],
    };

    for (const style of styles.meta?.styles || []) {
      const category = style.style_type === "FILL" ? "colors" :
                      style.style_type === "TEXT" ? "text" :
                      style.style_type === "EFFECT" ? "effects" :
                      style.style_type === "GRID" ? "grids" : null;

      if (category) {
        organized[category].push({
          name: style.name,
          key: style.key,
          description: style.description,
        });
      }
    }

    const totalStyles = organized.colors.length + organized.text.length +
                       organized.effects.length + organized.grids.length;

    const response = this.chunker.wrapResponse(
      { fileKey, styles: organized },
      {
        step: "File styles retrieved",
        progress: `${totalStyles} styles`,
        nextStep: "Use extract_styles(frame) for frame-specific tokens",
      }
    );

    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  repeatLast() {
    const lastResponse = this.session.getLastResponse();
    if (!lastResponse) {
      const response = this.chunker.wrapResponse(
        { message: "No previous response in session" },
        {
          step: "Repeat failed",
          nextStep: "Make a request first, then use repeat_last",
        }
      );
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
    return lastResponse;
  }

  getSessionState() {
    const state = this.session.getState();
    const response = this.chunker.wrapResponse(
      state,
      {
        step: "Session state retrieved",
        progress: state.currentFile ? "Active session" : "No active session",
        nextStep: "Use reset_session to clear state if needed",
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  resetSession() {
    this.session.reset();
    const response = this.chunker.wrapResponse(
      { message: "Session state cleared" },
      {
        step: "Session reset",
        progress: "Complete",
        nextStep: "Start fresh with list_pages(file_key)",
      }
    );
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Figma MCP Server v3.0.0 running - Intelligent Context Management");
  }
}

const server = new FigmaMCPServer();
server.run().catch(console.error);
