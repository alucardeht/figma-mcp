# Implementation Plan: Figma MCP v3.0 - Intelligent Context Management

**Branch**: `v3-intelligent-mcp` | **Date**: 2025-12-05 | **Spec**: `v3-intelligent-mcp.md`

## Summary

Transform the existing Figma MCP from a simple request/response server into an intelligent assistant that manages token budgets, maintains session state, and guides LLMs through optimal workflows.

## Technical Context

**Language/Version**: Node.js (ES Modules)
**Primary Dependencies**: @modelcontextprotocol/sdk, axios, sharp
**Storage**: In-memory (session state)
**Testing**: Manual + MCP Inspector
**Target Platform**: MCP Server (stdio)
**Project Type**: Single file → modular refactor
**Constraints**: <4000 tokens per response, session state must survive across calls

## Current Architecture

```
index.js (875 lines)
├── RateLimiter (class)
└── FigmaMCPServer (class)
    ├── setupHandlers() → 8 tools defined
    ├── Navigation: listPages, listFrames, getFrameInfo, findPageByName, findFrameByName
    ├── Screenshots: getScreenshot, segmentImage
    ├── Styles: extractStyles, collectStyles, getFileStyles
    ├── Assets: extractAssets, findAssets, buildAssetName, isIconNode, isImageNode
    └── Search: searchComponents, analyzeFrame
```

## Target Architecture v3.0

```
index.js
├── RateLimiter (existing)
├── TokenEstimator (NEW)
├── SessionManager (NEW)
├── ResponseChunker (NEW)
└── FigmaMCPServer (modified)
    ├── setupHandlers() → 11 tools (+3 new)
    ├── All methods wrapped with chunking/navigation
    └── _navigation and _guidance in all responses
```

## New Components

### 1. TokenEstimator

```javascript
class TokenEstimator {
  estimate(obj)           // Returns estimated token count for JSON object
  willExceed(obj, limit)  // Boolean check against limit
  static LIMITS = { DEFAULT: 4000, HARD: 5000, SUMMARY: 500 }
}
```

**Implementation**:
- Simple heuristic: `JSON.stringify(obj).length / 4` (rough token estimate)
- Can be refined later with tiktoken if needed

### 2. SessionManager

```javascript
class SessionManager {
  constructor()

  // State
  currentFile           // Current file_key being explored
  exploredPages         // Set of page IDs already sent
  exploredFrames        // Set of frame IDs already sent
  pendingChunks         // Map<operationId, { chunks: [], currentIndex: 0 }>
  lastResponse          // Last response sent (for repeat)

  // Methods
  setCurrentFile(fileKey)
  markPageExplored(pageId)
  markFrameExplored(frameId)

  storePendingChunks(operationId, chunks)
  getNextChunk(operationId)
  hasPendingChunks(operationId)

  storeLastResponse(response)
  getLastResponse()

  getState()            // Returns full state for debugging
  reset()               // Clear all state
}
```

### 3. ResponseChunker

```javascript
class ResponseChunker {
  constructor(tokenEstimator, sessionManager)

  // Main method - wraps any response
  wrapResponse(data, options = {})
  // Returns: { _navigation, _guidance?, data } or chunked version

  // Internal
  addNavigation(response, step, progress, nextStep)
  addGuidance(response, alert, strategy)
  chunkArray(array, maxTokensPerChunk)
  chunkObject(obj, maxTokensPerChunk)
}
```

## Modified Tools

### Existing Tools - Changes Required

| Tool | Changes |
|------|---------|
| `list_pages` | + `continue` param, + `_navigation`, + chunking if >50 pages |
| `list_frames` | + `continue` param, + `_navigation`, + `_guidance` if >50 frames |
| `get_frame_info` | + `continue` param, + `_navigation`, + `_guidance` for large frames |
| `get_screenshot` | + `_navigation` (no chunking needed) |
| `extract_styles` | + `_navigation` |
| `extract_assets` | + `_progress` updates, + frame-by-frame processing |
| `search_components` | + `continue` param, + refinement suggestions if >20 results |
| `get_file_styles` | + `_navigation` |

### New Tools

| Tool | Description |
|------|-------------|
| `repeat_last` | Return last response from session state |
| `get_session_state` | Return current session state for debugging |
| `reset_session` | Clear all session state |

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)
**Goal**: Add the 3 new classes without breaking existing functionality

1. Add `TokenEstimator` class after `RateLimiter`
2. Add `SessionManager` class after `TokenEstimator`
3. Add `ResponseChunker` class after `SessionManager`
4. Initialize in `FigmaMCPServer.constructor`:
   ```javascript
   this.tokenEstimator = new TokenEstimator();
   this.session = new SessionManager();
   this.chunker = new ResponseChunker(this.tokenEstimator, this.session);
   ```

**Test**: Server still starts and existing tools work unchanged

### Phase 2: Navigation Metadata (US5)
**Goal**: Every response includes `_navigation`

1. Create helper method `wrapWithNavigation(data, step, progress, nextStep)`
2. Update each tool's return to use wrapper:
   ```javascript
   // Before
   return { content: [{ type: "text", text: JSON.stringify(result) }] };

   // After
   return { content: [{ type: "text", text: JSON.stringify(
     this.wrapWithNavigation(result, "Listed pages", "1/1", "Use list_frames to explore a page")
   )}] };
   ```

**Test**: All responses have `_navigation` object

### Phase 3: Token Estimation & Chunking (US1)
**Goal**: Responses respect token limits

1. Before returning any response, check `tokenEstimator.willExceed()`
2. If exceeds, use `chunker.chunkArray()` or `chunkObject()`
3. Store remaining chunks in `session.pendingChunks`
4. Add `canContinue: true` to `_navigation` when chunks pending

**Test**: Large page with 100 frames returns first 20 with continuation info

### Phase 4: Continuation Support (US2)
**Goal**: `continue: true` parameter works

1. Add `continue` param to tool schemas that support it
2. In handler, check if `args.continue`:
   ```javascript
   if (args.continue && this.session.hasPendingChunks(operationId)) {
     return this.session.getNextChunk(operationId);
   }
   ```
3. Generate consistent `operationId` from tool name + file_key + params

**Test**: Call list_frames, get partial, call with continue=true, get next batch

### Phase 5: Large Content Warnings (US4)
**Goal**: Proactive `_guidance` for large content

1. In methods that fetch data, check size BEFORE processing everything
2. If large, return `_guidance.alert` with strategy
3. Implement refinement suggestions for search:
   ```javascript
   _guidance: {
     alert: "Found 10,234 components",
     refinementOptions: ["Filter by page", "Filter by type", "Narrow search term"]
   }
   ```

**Test**: Request huge page, get warning before data dump

### Phase 6: Session Tools (US3, US6)
**Goal**: repeat_last, get_session_state, reset_session

1. Add 3 new tools to `setupHandlers()`
2. Implement handlers:
   - `repeat_last`: Return `session.getLastResponse()`
   - `get_session_state`: Return `session.getState()`
   - `reset_session`: Call `session.reset()`, return confirmation

**Test**: Make call, call repeat_last, get same response

### Phase 7: Progressive Asset Extraction (US8)
**Goal**: Frame-by-frame progress for extract_assets

1. Modify `extractAssets` to process one frame at a time
2. After each frame, return progress update
3. Support continuation to get next frame's assets
4. Final response includes summary

**Test**: Extract assets from page with 5 frames, see progress for each

### Phase 8: Educational Descriptions (US7)
**Goal**: Tool descriptions explain workflows

1. Rewrite all tool descriptions with:
   - HOW IT WORKS section
   - TYPICAL WORKFLOW section
   - When to use continue

Example:
```javascript
description: `List frames in a page.

HOW IT WORKS:
- Large pages (>50 frames) are automatically chunked
- Use 'continue: true' to get next batch
- Session remembers what was sent

TYPICAL WORKFLOW:
1. list_pages → see all pages
2. list_frames(page_name) → see frames in page
3. get_frame_info(frame_name) → detail one frame`
```

**Test**: Read tool description, workflow is clear

## File Changes Summary

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `index.js` | Modify | +300 (new classes), +100 (wrappers), +50 (new tools) |

**Total estimated**: ~450 new lines, keeping single file structure for simplicity

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing integrations | Phase 1-2 are additive only, existing responses unchanged |
| Token estimation inaccurate | Start with simple heuristic, refine based on real usage |
| Session state memory leak | Add TTL to session data (clear after 30 min inactivity) |
| Continuation state corruption | Generate deterministic operationIds, validate before returning |

## Execution Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
   │         │         │         │         │         │         │         │
   └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
                                    │
                              All phases are
                              incremental and
                              independently testable
```

Each phase produces working code. Can ship after Phase 4 for MVP (token safety + continuation).
