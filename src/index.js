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
            result = await handlers.getFrameInfo(this.ctx, args.file_key, args.page_name, args.frame_name, args.depth || 2, args.continue, args.node_id);
            break;
          case "get_screenshot":
            result = await handlers.getScreenshot(this.ctx, args.file_key, args.page_name, args.frame_name, args.scale || 2, args.max_dimension || 4096, args.node_id);
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
          case "analyze_page_structure":
            result = await handlers.analyzePageStructure(this.ctx, args.file_key, args.page_name, args.frame_name);
            break;
          case "get_section_screenshot":
            result = await handlers.getSectionScreenshot(this.ctx, args.file_key, args.page_name, args.frame_name, args.section_id, args.include_transition_context !== false, args.scale || 2);
            break;
          case "get_agent_context":
            result = await handlers.getAgentContext(
              this.ctx,
              args.file_key,
              args.page_name,
              args.frame_name,
              args.section_id,
              args.agent_index || 0,
              args.total_agents || 1
            );
            break;
          case "get_full_page_context":
            result = await handlers.getFullPageContext(this.ctx, args);
            break;
          case "check_layout_bounds":
            result = await handlers.checkLayoutBounds(this.ctx, args);
            break;
          case "compare_element_position":
            result = await handlers.compareElementPosition(this.ctx, args);
            break;
          case "compare_element_dimensions":
            result = await handlers.compareElementDimensions(this.ctx, args);
            break;
          case "validate_layout":
            result = await handlers.validateLayout(this.ctx, args);
            break;
          case "compare_visual":
            result = await handlers.compareVisual(this.ctx, args);
            break;
          case "verify_elements_present":
            result = await handlers.verifyElementsPresent(this.ctx, args);
            break;
          case "verify_assets_loaded":
            result = await handlers.verifyAssetsLoaded(this.ctx, args);
            break;
          case "verify_implementation_v2":
            result = await handlers.verifyImplementationConsolidated(this.ctx, args);
            break;
          case "validate_responsive_breakpoint":
            result = await handlers.validateResponsiveBreakpoint(this.ctx, args);
            break;
          case "test_all_breakpoints":
            result = await handlers.testAllBreakpoints(this.ctx, args);
            break;
          case "validate_implementation":
            result = await handlers.validateImplementation(this.ctx, args);
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
