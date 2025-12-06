import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { TokenEstimator, SessionManager, ResponseChunker } from "./classes/index.js";
import FigmaClient from "./api/figma.js";
import { toolSchemas } from "./tools/schemas.js";
import * as handlers from "./tools/handlers/index.js";

const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;

class FigmaMCPServer {
  constructor() {
    this.server = new Server({ name: "figma-mcp-server", version: "3.0.0" }, { capabilities: { tools: {} } });
    this.tokenEstimator = new TokenEstimator();
    this.session = new SessionManager();
    this.chunker = new ResponseChunker(this.tokenEstimator, this.session);
    this.figmaClient = new FigmaClient(FIGMA_API_TOKEN);
    this.setupHandlers();
  }

  get ctx() {
    return {
      session: this.session,
      chunker: this.chunker,
      figmaClient: this.figmaClient,
    };
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolSchemas,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!FIGMA_API_TOKEN && !["repeat_last", "get_session_state", "reset_session"].includes(name)) {
        throw new Error("FIGMA_API_TOKEN not set. Export it or add to your MCP config.");
      }

      try {
        let result;
        switch (name) {
          case "list_pages":
            result = await handlers.listPages(this.ctx, args.file_key, args.continue);
            break;
          case "list_frames":
            result = await handlers.listFrames(this.ctx, args.file_key, args.page_name, args.continue);
            break;
          case "get_frame_info":
            result = await handlers.getFrameInfo(this.ctx, args.file_key, args.page_name, args.frame_name, args.depth || 2, args.continue);
            break;
          case "get_screenshot":
            result = await handlers.getScreenshot(this.ctx, args.file_key, args.page_name, args.frame_name, args.scale || 2, args.max_dimension || 4096);
            break;
          case "extract_styles":
            result = await handlers.extractStyles(this.ctx, args.file_key, args.page_name, args.frame_name);
            break;
          case "extract_assets":
            result = await handlers.extractAssets(this.ctx, args.file_key, args.page_name, args.frame_name, args.output_dir || "./figma-assets");
            break;
          case "search_components":
            result = await handlers.searchComponents(this.ctx, args.file_key, args.query, args.page_name, args.type, args.continue);
            break;
          case "get_file_styles":
            result = await handlers.getFileStyles(this.ctx, args.file_key);
            break;
          case "repeat_last":
            result = handlers.repeatLast(this.ctx);
            break;
          case "get_session_state":
            result = handlers.getSessionState(this.ctx);
            break;
          case "reset_session":
            result = handlers.resetSession(this.ctx);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        this.session.storeLastResponse(result);
        return result;
      } catch (error) {
        const errorResponse = {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                this.chunker.wrapResponse({ error: error.message }, { step: "Error", nextStep: "Check parameters and try again" }),
                null,
                2
              ),
            },
          ],
        };
        return errorResponse;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Figma MCP Server v3.0.0 running - Intelligent Context Management");
  }
}

const server = new FigmaMCPServer();
server.run().catch(console.error);
