# Feature Specification: Figma MCP v3.0 - Intelligent Context Management

**Feature Branch**: `v3-intelligent-mcp`
**Created**: 2025-12-05
**Status**: Draft
**Input**: PROJECT_VISION.md - Transform MCP into intelligent assistant for LLM-driven design building

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TYPICAL LLM WORKFLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. LIST PAGES (summary)                                                    │
│     └─→ Response: pages + _navigation.nextStep: "list_frames for details"  │
│                                                                             │
│  2. LIST FRAMES (page_name)                                                 │
│     ├─→ Small page: all frames + nextStep: "get_frame_details"             │
│     └─→ Large page: first 20 + _guidance.alert + continue instructions     │
│                                                                             │
│  3. GET FRAME DETAILS (frame_name)                                          │
│     ├─→ Small frame: full structure                                         │
│     └─→ Large frame: summary + strategy + drill-down options               │
│                                                                             │
│  4. EXTRACT ASSETS (frame_name)                                             │
│     └─→ Progress updates: "icons: 5/12, images: 3/8" + final summary       │
│                                                                             │
│  5. GET STYLES (optional)                                                   │
│     └─→ Design tokens: colors, typography, spacing                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

CONTINUATION FLOW:
  Any response with canContinue=true → call same tool with continue=true → next chunk

REPEAT FLOW:
  Lost context? → repeat_last → same response without API call
```

## Test Scenarios Mapping (from PROJECT_VISION.md)

| # | Scenario | Expected Behavior | Covered By |
|---|----------|-------------------|------------|
| 1 | "Show me the landing page" (huge) | Warning + strategy + part 1 + how to continue | US4 + US1 + US2 |
| 2 | "Search for all buttons" (10,000 results) | Top 20 + "found 10,000 total" + how to refine | US4 (refinement) |
| 3 | "Continue" after partial response | Part 2 starting where it left off | US2 |
| 4 | "Repeat what you showed me" | Same content from state, no API call | US6 |
| 5 | "Extract all assets from this page" | Divided by frame, progress updates, final summary | US8 (NEW) |

## User Scenarios & Testing

### User Story 1 - Token-Safe Response Delivery (Priority: P1)

LLM requests page structure from a large Figma file. MCP estimates token count before sending and automatically chunks response if it exceeds safe limits (~4000 tokens), providing clear continuation instructions.

**Why this priority**: Without token management, everything else fails. Context overflow blocks all further work.

**Independent Test**: Request structure of a page with 50+ frames. Response must fit in token budget with clear "more available" indicator.

**Acceptance Scenarios**:

1. **Given** a page with 100 frames, **When** LLM calls `list_frames`, **Then** response contains first batch (~20 frames) + navigation metadata showing "20 of 100" + instructions to continue
2. **Given** a frame with 5000 elements, **When** LLM calls `get_frame_details`, **Then** MCP returns summary + warning about size + strategy for accessing details
3. **Given** any response, **When** MCP prepares output, **Then** `_navigation.tokensThisResponse` field shows estimated token count

---

### User Story 2 - Continuation Support (Priority: P1)

After receiving a partial response, LLM can call with `continue: true` to get the next chunk. MCP remembers where it stopped and continues from that point.

**Why this priority**: Continuation is essential for handling any large content. Without it, users can't access complete data.

**Independent Test**: Call `list_frames`, receive partial response, call with `continue: true`, receive next batch starting exactly where previous ended.

**Acceptance Scenarios**:

1. **Given** partial response was sent for `list_frames`, **When** LLM calls `list_frames({ continue: true })`, **Then** response contains next batch starting from frame 21
2. **Given** multiple pending chunks exist, **When** LLM calls continue multiple times, **Then** each call returns next sequential chunk until complete
3. **Given** no previous partial response, **When** LLM calls with `continue: true`, **Then** MCP returns helpful error explaining no pending continuation

---

### User Story 3 - Session State Management (Priority: P2)

MCP maintains state across calls within a session: current file, explored pages, what was sent, pending items. This enables efficient navigation and avoids redundant data transfer.

**Why this priority**: State enables smart behavior like "repeat" and prevents re-sending same data.

**Independent Test**: Make 3 sequential calls exploring a file. State correctly tracks which pages/frames were already sent.

**Acceptance Scenarios**:

1. **Given** LLM explored page "Login", **When** LLM requests "Login" again, **Then** MCP can return from cache or indicate "already sent in this session"
2. **Given** session has state, **When** LLM calls `get_session_state`, **Then** response shows: current file, explored pages, pending items, items already delivered
3. **Given** LLM wants fresh start, **When** LLM calls `reset_session`, **Then** all state is cleared

---

### User Story 4 - Proactive Large Content Warnings (Priority: P2)

When MCP detects content will be large (before fetching full data), it proactively warns and suggests strategy instead of trying to send everything.

**Why this priority**: Prevents wasted API calls and context overflow by planning ahead.

**Independent Test**: Request details of a frame known to have 10,000+ elements. MCP warns before attempting full fetch.

**Acceptance Scenarios**:

1. **Given** page has 50+ frames, **When** LLM calls `get_page_structure`, **Then** response includes `_guidance.alert` with size warning and recommended approach
2. **Given** frame has 1000+ elements, **When** LLM requests full details, **Then** MCP suggests hierarchy-based approach (top-level first, then drill down)
3. **Given** search would return 500+ results, **When** LLM searches, **Then** MCP returns top 20 + total count + refinement suggestions (e.g., "Try filtering by page: 'Login', or by type: 'INSTANCE'")
4. **Given** search returns many results, **When** checking response, **Then** `_guidance.refinementOptions` lists available filters: by page, by type, by name pattern

---

### User Story 5 - Navigation Guidance in Responses (Priority: P2)

Every response includes `_navigation` metadata that guides LLM on current position, progress, and suggested next steps.

**Why this priority**: Self-explanatory responses reduce back-and-forth and help LLM make smart decisions.

**Independent Test**: Any response includes `_navigation` with currentStep, progress, nextStep, tokensThisResponse.

**Acceptance Scenarios**:

1. **Given** any successful response, **When** checking output, **Then** `_navigation` object exists with: currentStep (string), progress (string), nextStep (string), tokensThisResponse (number)
2. **Given** exploring a file, **When** at different stages, **Then** `nextStep` suggests contextually appropriate action (e.g., "detail frames" after listing, "extract assets" after analyzing)
3. **Given** operation completed fully, **When** checking output, **Then** `_navigation.canContinue` is false

---

### User Story 6 - Repeat Last Response (Priority: P3)

LLM can request to repeat the last response without making new API calls to Figma. Useful for context recovery.

**Why this priority**: Nice-to-have for context management but not critical for core functionality.

**Independent Test**: After any response, call `repeat_last` and receive identical data without Figma API call.

**Acceptance Scenarios**:

1. **Given** previous response was sent, **When** LLM calls `repeat_last`, **Then** exact same response is returned from state (no API call)
2. **Given** no previous response in session, **When** LLM calls `repeat_last`, **Then** helpful error explaining nothing to repeat
3. **Given** previous response was chunked, **When** LLM calls `repeat_last`, **Then** returns same chunk that was last sent

---

### User Story 7 - Educational Tool Descriptions (Priority: P3)

Tool descriptions in MCP schema explain HOW the MCP works, typical workflows, and best practices. LLMs learn from descriptions alone.

**Why this priority**: Improves LLM efficiency but not blocking for functionality.

**Independent Test**: Read tool description, understand: how chunking works, what continue does, recommended workflow.

**Acceptance Scenarios**:

1. **Given** tool `list_frames`, **When** reading description, **Then** includes: what it does, how chunking works, typical next steps
2. **Given** tool `get_frame_details`, **When** reading description, **Then** explains: summary vs full mode, token implications, recommended approach for large frames
3. **Given** any tool, **When** reading description, **Then** includes "TYPICAL WORKFLOW" section with numbered steps

---

### User Story 8 - Progressive Asset Extraction (Priority: P1)

When extracting assets from a page/frame with many assets, MCP divides work by frame, provides progress updates, and delivers a final summary. Never dumps everything at once.

**Why this priority**: Asset extraction is a core use case. Without progress tracking, large extractions appear stuck or fail silently.

**Independent Test**: Extract assets from page with 5 frames, each with 10+ assets. Receive progress updates per frame, then final summary.

**Acceptance Scenarios**:

1. **Given** page has 5 frames with assets, **When** LLM calls `extract_assets({ page: "Landing" })`, **Then** MCP processes frame by frame with progress: "Processing frame 1/5: Header - found 8 icons, 3 images"
2. **Given** extraction in progress, **When** each frame completes, **Then** response includes `_progress`: { currentFrame: "Header", framesProcessed: 1, totalFrames: 5, assetsFound: { icons: 8, images: 3 } }
3. **Given** extraction completes, **When** all frames processed, **Then** final response includes summary: total assets extracted, organized by type, file paths on disk
4. **Given** single frame requested, **When** LLM calls `extract_assets({ frame: "Login Form" })`, **Then** extracts only that frame with same progress format
5. **Given** very large frame (100+ assets), **When** extracting, **Then** MCP chunks asset delivery with continuation support

---

### Edge Cases

- What happens when Figma API rate limit is hit mid-continuation?
- How does system handle session timeout (very long pause between calls)?
- What if file structure changes between continuation calls?
- How to handle corrupted/incomplete state?

## Requirements

### Functional Requirements

- **FR-001**: MCP MUST estimate token count for every response before sending
- **FR-002**: MCP MUST automatically chunk responses exceeding 4000 tokens
- **FR-003**: MCP MUST support `continue: true` parameter on all list/detail operations
- **FR-004**: MCP MUST maintain session state including: current file, explored items, pending chunks, delivered items
- **FR-005**: MCP MUST include `_navigation` metadata in every successful response
- **FR-006**: MCP MUST detect large content (>1000 elements or >50 items) and warn proactively
- **FR-007**: MCP MUST support `repeat_last` operation returning cached previous response
- **FR-008**: MCP MUST support `get_session_state` operation for debugging/visibility
- **FR-009**: MCP MUST support `reset_session` to clear all state
- **FR-010**: Tool descriptions MUST include workflow guidance and chunking explanation
- **FR-011**: MCP MUST provide progress updates during multi-frame asset extraction
- **FR-012**: MCP MUST deliver final summary after asset extraction with: total counts, organization by type, file paths
- **FR-013**: Search results MUST include refinement suggestions when results exceed 20 items

### Key Entities

- **Session**: Represents conversation state - current file, position, history, pending continuations
- **Chunk**: A portion of a larger response with metadata (index, total, hasMore)
- **NavigationContext**: Metadata object (_navigation) with progress, next steps, token count
- **GuidanceAlert**: Warning object (_guidance) for large content with strategy suggestions
- **ProgressReport**: Metadata object (_progress) for long operations with current step, completed, total, partial results
- **RefinementOptions**: Suggestions for narrowing search results (_guidance.refinementOptions)

## Success Criteria

### Measurable Outcomes

- **SC-001**: No response ever exceeds 5000 tokens (hard limit)
- **SC-002**: Average response fits within 2000 tokens for typical operations
- **SC-003**: LLM can navigate entire large file (100+ frames) without context overflow
- **SC-004**: Continuation works correctly 100% of time - no data loss, no duplicates
- **SC-005**: Session state correctly tracks all operations within conversation
- **SC-006**: Large content warning appears before any operation that would exceed limits
- **SC-007**: Asset extraction provides progress update for each frame processed
- **SC-008**: Search with >20 results always includes refinement suggestions
- **SC-009**: All 5 test scenarios from PROJECT_VISION.md pass successfully
