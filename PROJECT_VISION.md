# Figma MCP Server - Project Vision

## Core Problem

Traditional Figma MCPs have critical issues:
1. **Token overflow** - Return raw, unstructured data that blows up context windows
2. **Manual ID copying** - Force users to manually get IDs from Figma URLs
3. **No intelligence** - Just dumb request/response, no guidance
4. **Silent truncation** - Cut data without explaining what's missing
5. **No state** - Don't remember what was already sent to LLM

## The Real Objective

**The MCP exists to help LLMs build designs from Figma files.**

Users don't want to:
- Go to Figma item by item downloading SVGs/images
- Manually organize assets into folders
- Read styles one by one (font sizes, colors, spacing)
- Copy structure manually

The MCP should **translate Figma into something the LLM can work with** to build the design elegantly and directly, without getting lost, using **minimal context**.

## Key Principles

### 1. Never Block Without Reason
- User HATES when things just stop
- If something is too big, DON'T refuse - DIVIDE and GUIDE
- Always explain what's happening and offer next steps

### 2. Proactive Intelligence
- If we KNOW a page is huge, warn BEFORE trying to send everything
- Suggest better approaches (summary first, then details)
- Take initiative in dividing content intelligently

### 3. State/Memory Between Calls
The MCP must maintain:
- What has already been sent to the LLM
- What parts are still pending
- Current position in navigation
- Ability to "continue" from where it stopped
- Handle "repeat what you showed me" correctly

### 4. Context is Precious
- Every token counts
- Responses must be compact but complete
- Never send redundant data
- Estimate tokens before sending

### 5. Guide the Development
The MCP already knows the user's goal (build a design), so it should:
- Suggest optimal workflow
- Divide work into logical chunks
- Explain how the navigation works
- Offer next steps proactively

## Architecture Vision

```
┌──────────────┐      ┌─────────────────────────┐      ┌──────────┐
│     LLM      │ ←──→ │    INTELLIGENT MCP      │ ←──→ │  FIGMA   │
└──────────────┘      │                         │      └──────────┘
                      │  • SessionManager       │
                      │  • TokenEstimator       │
                      │  • NavigationGuide      │
                      │  • ResponseChunker      │
                      │  • StateTracker         │
                      │  • RateLimiter          │
                      │  • Cache                │
                      └─────────────────────────┘
```

### Core Components

**SessionManager**
- Maintains state across calls
- Tracks what was sent vs pending
- Handles "continue" and "repeat" requests

**TokenEstimator**
- Estimates response size before sending
- Enforces max tokens per response (~4000 recommended)
- Triggers chunking when needed

**NavigationGuide**
- Knows the typical workflow (pages → frames → details → assets)
- Suggests next steps
- Educates LLM on how to use the MCP efficiently

**ResponseChunker**
- Divides large responses intelligently
- Adds navigation metadata (_navigation, _guidance)
- Maintains coherence across chunks

**StateTracker**
- Remembers current file, explored pages, pending items
- Tracks assets already delivered
- Provides context for continuation

## Response Format

### Standard Response with Navigation Context
```json
{
  "_navigation": {
    "currentStep": "Showing Login page structure",
    "progress": "1 of 3 relevant pages",
    "nextStep": "Can detail frames or extract assets",
    "tokensThisResponse": 850,
    "canContinue": true
  },
  "data": { ... }
}
```

### Large Content Warning
```json
{
  "_guidance": {
    "alert": "Page 'Embarcadora' has 16 frames and ~45,000 elements",
    "strategy": "Dividing into 3 parts: structure → components → assets",
    "part": "1/3 - General structure",
    "remainingParts": ["2/3 - Components", "3/3 - Assets"]
  },
  "data": { ... summary ... }
}
```

### Continuation Support
```javascript
// Call 1:
get_page_structure({ page: "Landing" })
// Response: part 1/3 + "call with continue=true for next"

// Call 2:
get_page_structure({ continue: true })
// Response: part 2/3 (MCP knows where it stopped)
```

## Tool Descriptions Should Educate

Tool descriptions should explain HOW the MCP works:

```javascript
{
  name: "get_page_structure",
  description: `Get optimized Figma page structure.

  HOW IT WORKS:
  - Large pages are automatically divided
  - MCP maintains state of what was sent
  - Use 'continue' to receive next part
  - Use 'summary' for overview before details

  TYPICAL WORKFLOW:
  1. get_page_structure(summary=true) → overview
  2. get_frame_details(frame="Login") → one frame
  3. extract_assets(frame="Login") → assets for that frame
  4. Repeat for other frames`
}
```

## Token Budget Guidelines

| Response Type | Max Tokens | Strategy |
|---------------|------------|----------|
| Page list | ~500 | Usually fits |
| Frame list | ~1000 | Paginate if >20 frames |
| Frame details | ~2000 | Limit depth, offer more |
| Search results | ~1500 | Show top 20, explain total |
| Assets summary | ~500 | Just names, paths on disk |

## What v2.0 Has (Current State)

- ✅ Navigation by name (partial match)
- ✅ Rate limiting with tier awareness
- ✅ Request caching
- ✅ Organized asset extraction (icons/images)
- ✅ Design token extraction
- ✅ Screenshot segmentation for large frames
- ✅ Compact JSON output

## What v3.0 Needs (To Implement)

- ❌ Session state management
- ❌ Token estimation before sending
- ❌ Intelligent chunking with continuation
- ❌ Navigation guidance in responses
- ❌ Proactive warnings for large content
- ❌ "Continue" and "repeat" support
- ❌ Educational tool descriptions
- ❌ Progress tracking across calls

## Success Criteria

1. **Never overflow context** - Responses always fit comfortably
2. **Never block unnecessarily** - Always offer a path forward
3. **LLM can build complete design** - From Figma to code seamlessly
4. **Minimal token usage** - Efficient, no redundancy
5. **Self-explanatory** - LLM understands how to navigate without external docs

## Test Scenarios

1. "Show me the landing page" (huge page)
   - Expected: Warning + strategy + part 1 + how to continue

2. "Search for all buttons" (10,000 results)
   - Expected: Top 20 + "found 10,000 total" + how to refine

3. "Continue" after partial response
   - Expected: Part 2 starting where it left off

4. "Repeat what you showed me"
   - Expected: Same content from state, not new API call

5. "Extract all assets from this page"
   - Expected: Divided by frame, progress updates, final summary
