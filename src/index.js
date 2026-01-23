import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/register.js';
import { TokenEstimator, SessionManager, ResponseChunker } from './classes/index.js';
import FigmaClient from './api/figma.js';

const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;

class FigmaMCPServer {
  constructor() {
    this.server = new McpServer({
      name: 'figma-mcp-server',
      version: '3.1.0'
    });

    this.tokenEstimator = new TokenEstimator();
    this.session = new SessionManager();
    this.chunker = new ResponseChunker(this.tokenEstimator, this.session);
    this.figmaClient = new FigmaClient(FIGMA_API_TOKEN);

    this.ctx = {
      figmaClient: this.figmaClient,
      session: this.session,
      tokenEstimator: this.tokenEstimator,
      chunker: this.chunker
    };

    registerAllTools(this.server, this.ctx);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Figma MCP Server v3.1.0 running - McpServer + Zod');
  }
}

const server = new FigmaMCPServer();
server.run().catch(console.error);
