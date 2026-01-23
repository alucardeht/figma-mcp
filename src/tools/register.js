import * as repeatLast from './definitions/repeatLast.js';
import * as getSessionState from './definitions/getSessionState.js';
import * as resetSession from './definitions/resetSession.js';
import * as figmaGet from './definitions/figmaGet.js';
import * as figmaScreenshot from './definitions/figmaScreenshot.js';
import * as extractAssets from './definitions/extractAssets.js';
import * as figmaStyles from './definitions/figmaStyles.js';
import * as figmaValidate from './definitions/figmaValidate.js';
import * as figmaContext from './definitions/figmaContext.js';

const tools = [
  repeatLast,
  getSessionState,
  resetSession,
  figmaGet,
  figmaScreenshot,
  extractAssets,
  figmaStyles,
  figmaValidate,
  figmaContext,
];

export function registerAllTools(server, ctx) {
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (args) => tool.handler(args, ctx)
    );
  }
}
