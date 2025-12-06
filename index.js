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

class FigmaMCPServer {
  constructor() {
    this.server = new Server(
      { name: "figma-mcp-server", version: "2.0.0" },
      { capabilities: { tools: {} } }
    );
    this.rateLimiter = new RateLimiter();
    this.cache = new Map();
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
          description: "List all pages in a Figma file. Returns compact JSON with page names and IDs. Use this first to discover what's in the file.",
          inputSchema: {
            type: "object",
            properties: {
              file_key: {
                type: "string",
                description: "Figma file key from URL (e.g., 'h75vgHNcwxfHkRBbI53RRu' from figma.com/design/h75vgHNcwxfHkRBbI53RRu/...)",
              },
            },
            required: ["file_key"],
          },
        },
        {
          name: "list_frames",
          description: "List frames/screens in a specific page. Search by page name (partial match supported). Returns compact list with frame names, sizes, and IDs.",
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name to search (partial match, case-insensitive)" },
            },
            required: ["file_key", "page_name"],
          },
        },
        {
          name: "get_frame_info",
          description: "Get detailed info about a specific frame including all components, text, colors, and styles. Search by frame name within a page.",
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              page_name: { type: "string", description: "Page name (partial match)" },
              frame_name: { type: "string", description: "Frame name to search (partial match)" },
              depth: { type: "number", description: "How deep to traverse (1=direct children, 2=grandchildren, etc. Default: 2)", default: 2 },
            },
            required: ["file_key", "page_name", "frame_name"],
          },
        },
        {
          name: "get_screenshot",
          description: "Capture screenshot of a frame. For large frames, automatically segments into tiles. Returns base64 image(s).",
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
          description: "Extract all design tokens from a frame: colors, fonts, spacing, border radius, shadows. Returns organized JSON.",
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
          description: "Extract all assets from a frame. Automatically categorizes into icons/ and images/ folders. Uses smart naming based on component hierarchy.",
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
          description: "Search for components by name across the entire file or within a specific page. Great for finding buttons, icons, etc.",
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
              query: { type: "string", description: "Search term (case-insensitive, partial match)" },
              page_name: { type: "string", description: "Optional: limit search to specific page" },
              type: { type: "string", description: "Filter by type: COMPONENT, INSTANCE, FRAME, TEXT, VECTOR, etc." },
            },
            required: ["file_key", "query"],
          },
        },
        {
          name: "get_file_styles",
          description: "Get all published styles (colors, text styles, effects) defined in the file. These are the design system tokens.",
          inputSchema: {
            type: "object",
            properties: {
              file_key: { type: "string", description: "Figma file key" },
            },
            required: ["file_key"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!FIGMA_API_TOKEN) {
        throw new Error("FIGMA_API_TOKEN not set. Export it or add to your MCP config.");
      }

      try {
        switch (name) {
          case "list_pages": return await this.listPages(args.file_key);
          case "list_frames": return await this.listFrames(args.file_key, args.page_name);
          case "get_frame_info": return await this.getFrameInfo(args.file_key, args.page_name, args.frame_name, args.depth || 2);
          case "get_screenshot": return await this.getScreenshot(args.file_key, args.page_name, args.frame_name, args.scale || 2, args.max_dimension || 4096);
          case "extract_styles": return await this.extractStyles(args.file_key, args.page_name, args.frame_name);
          case "extract_assets": return await this.extractAssets(args.file_key, args.page_name, args.frame_name, args.output_dir || "./figma-assets");
          case "search_components": return await this.searchComponents(args.file_key, args.query, args.page_name, args.type);
          case "get_file_styles": return await this.getFileStyles(args.file_key);
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    });
  }

  async getFileData(fileKey, depth = 1) {
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

  async listPages(fileKey) {
    const file = await this.getFileData(fileKey, 1);

    const pages = file.document.children.map(page => ({
      name: page.name,
      id: page.id,
      frameCount: page.children?.filter(c =>
        c.type === "FRAME" || c.type === "COMPONENT"
      ).length || 0,
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          file: file.name,
          lastModified: file.lastModified,
          pages,
        }, null, 2),
      }],
    };
  }

  async listFrames(fileKey, pageName) {
    const file = await this.getFileData(fileKey, 2);
    const page = this.findPageByName(file, pageName);

    if (!page) {
      const available = file.document.children.map(p => p.name).join(", ");
      throw new Error(`Page "${pageName}" not found. Available: ${available}`);
    }

    const frames = (page.children || [])
      .filter(c => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET")
      .map(f => ({
        name: f.name,
        id: f.id,
        type: f.type,
        width: Math.round(f.absoluteBoundingBox?.width || 0),
        height: Math.round(f.absoluteBoundingBox?.height || 0),
        childCount: f.children?.length || 0,
      }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          page: page.name,
          frameCount: frames.length,
          frames,
        }, null, 2),
      }],
    };
  }

  async getFrameInfo(fileKey, pageName, frameName, depth) {
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
    const analysis = this.analyzeFrame(frame, depth);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(analysis, null, 2),
      }],
    };
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

      return {
        content: [
          {
            type: "text",
            text: `Frame "${frame.name}" (${Math.round(width)}x${Math.round(height)}px) - Segmented into ${tiles.length} tiles`,
          },
          ...tiles.map((tile, i) => ({
            type: "image",
            data: tile.data,
            mimeType: "image/png",
          })),
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Frame: ${frame.name}\nSize: ${Math.round(width)}x${Math.round(height)}px`,
        },
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

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          frame: frame.name,
          designTokens: {
            colors: [...styles.colors].sort(),
            fonts: [...styles.fonts].sort(),
            fontSizes: [...styles.fontSizes].sort((a, b) => a - b),
            borderRadii: [...styles.borderRadii].sort((a, b) => a - b),
            spacing: [...styles.spacing].sort((a, b) => a - b),
            shadows: styles.shadows,
          },
        }, null, 2),
      }],
    };
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

    for (let i = 0; i < assets.length; i += batchSize) {
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

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          frame: frame.name,
          outputDir,
          summary: {
            icons: results.icons.length,
            images: results.images.length,
            failed: results.failed.length,
          },
          icons: results.icons.map(i => i.name),
          images: results.images.map(i => i.name),
          failed: results.failed,
        }, null, 2),
      }],
    };
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

  async searchComponents(fileKey, query, pageName, type) {
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

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          query,
          resultCount: results.length,
          results: results.slice(0, 50),
        }, null, 2),
      }],
    };
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

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          fileKey,
          styles: organized,
        }, null, 2),
      }],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Figma MCP Server v2.0.0 running");
  }
}

const server = new FigmaMCPServer();
server.run().catch(console.error);
