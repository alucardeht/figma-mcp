import * as repeatLast from './definitions/repeatLast.js';
import * as getSessionState from './definitions/getSessionState.js';
import * as resetSession from './definitions/resetSession.js';
import * as listPages from './definitions/listPages.js';
import * as listFrames from './definitions/listFrames.js';
import * as getFrameInfo from './definitions/getFrameInfo.js';
import * as getScreenshot from './definitions/getScreenshot.js';
import * as extractStyles from './definitions/extractStyles.js';
import * as getFileStyles from './definitions/getFileStyles.js';
import * as extractAssets from './definitions/extractAssets.js';
import * as searchComponents from './definitions/searchComponents.js';
import * as analyzePageStructure from './definitions/analyzePageStructure.js';
import * as getSectionScreenshot from './definitions/getSectionScreenshot.js';
import * as getAgentContext from './definitions/getAgentContext.js';
import * as getFullPageContext from './definitions/getFullPageContext.js';
import * as checkLayoutBounds from './definitions/checkLayoutBounds.js';
import * as compareElementPosition from './definitions/compareElementPosition.js';
import * as compareElementDimensions from './definitions/compareElementDimensions.js';
import * as validateLayout from './definitions/validateLayout.js';
import * as compareVisual from './definitions/compareVisual.js';
import * as verifyElementsPresent from './definitions/verifyElementsPresent.js';
import * as verifyAssetsLoaded from './definitions/verifyAssetsLoaded.js';
import * as verifyImplementationV2 from './definitions/verifyImplementationV2.js';
import * as validateResponsiveBreakpoint from './definitions/validateResponsiveBreakpoint.js';
import * as testAllBreakpoints from './definitions/testAllBreakpoints.js';
import * as validateImplementation from './definitions/validateImplementation.js';

const tools = [
  repeatLast,
  getSessionState,
  resetSession,
  listPages,
  listFrames,
  getFrameInfo,
  getScreenshot,
  extractStyles,
  getFileStyles,
  extractAssets,
  searchComponents,
  analyzePageStructure,
  getSectionScreenshot,
  getAgentContext,
  getFullPageContext,
  checkLayoutBounds,
  compareElementPosition,
  compareElementDimensions,
  validateLayout,
  compareVisual,
  verifyElementsPresent,
  verifyAssetsLoaded,
  verifyImplementationV2,
  validateResponsiveBreakpoint,
  testAllBreakpoints,
  validateImplementation,
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
