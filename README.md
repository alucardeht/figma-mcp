# mcp-server-figma

[![npm version](https://img.shields.io/npm/v/mcp-server-figma.svg)](https://www.npmjs.com/package/mcp-server-figma)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A powerful Model Context Protocol (MCP) server for seamless Figma integration**

v3.0.0 — Intelligent context management, smart pagination, and efficient asset extraction.

---

## Features

### Intelligent Context Management
- **Smart Pagination**: Automatically pages large result sets (20 items per page)
- **Token Estimation**: Warns users when results are large before fetching
- **Continue Pattern**: Resume pagination with `continue=true` parameter
- **Session State**: Maintains context across multiple requests

### Smart Navigation
- **Name-Based Access**: Navigate files and frames using human-readable names—no IDs required
- **Repeat Last**: Instantly replay the previous response from cache with `repeat_last()`
- **Session Control**: View and reset session state for debugging

### Asset Management
- **Organized Extraction**: Automatically structures exported assets into `icons/` and `images/` folders
- **Design Token Export**: Extract published styles, colors, and typography as design tokens
- **Smart Scaling**: Configurable screenshot dimensions with intelligent aspect ratio preservation

### Performance & Reliability
- **Rate Limit Management**: Built-in awareness of Figma's API rate limits
- **Efficient Batching**: Reduces API calls through intelligent request bundling
- **Graceful Degradation**: Clear warnings and fallbacks when approaching rate limits

---

## Installation

The easiest way to use mcp-server-figma is via **npx** in your Claude client configuration.

### Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "github:alucardeht/mcp-server-figma"],
      "env": {
        "FIGMA_API_TOKEN": "your-figma-token-here"
      }
    }
  }
}
```

### Manual Installation

```bash
git clone https://github.com/alucardeht/mcp-server-figma
cd mcp-server-figma
npm install
npm start
```

---

## Getting Your Figma API Token

1. Open [Figma Settings](https://figma.com/settings)
2. Navigate to **Personal access tokens**
3. Click **Create a new token**
4. Give it a name (e.g., "MCP Server")
5. Copy the token immediately (it won't be shown again)
6. Add it to your Claude configuration as `FIGMA_API_TOKEN`

**Permissions needed**: Read-only access to your files (the token is automatically scoped correctly)

---

## Available Tools

### Navigation & Discovery

#### `list_pages(file_key, continue?)`
Lists all pages in a Figma file.
- **file_key**: The file ID or URL
- **continue?**: `true` to fetch the next page of results
- **Returns**: Array of pages with names and metadata

#### `list_frames(file_key, page_name, continue?)`
Lists all frames/artboards on a specific page.
- **file_key**: The file ID
- **page_name**: Human-readable page name (e.g., "Components")
- **continue?**: `true` to fetch more results
- **Returns**: Frame names, dimensions, and positions

#### `get_frame_info(file_key, page_name, frame_name, depth?, continue?)`
Gets detailed information about a frame, including its contents and structure.
- **file_key**: The file ID
- **page_name**: Page name
- **frame_name**: Frame/component name
- **depth?**: Nesting depth to explore (default: 2)
- **continue?**: Pagination for large frames
- **Returns**: Nested structure with all elements, text, and properties

### Content Extraction

#### `get_screenshot(file_key, page_name, frame_name, scale?, max_dimension?)`
Exports a frame as an image.
- **file_key**: The file ID
- **page_name**: Page name
- **frame_name**: Frame name
- **scale?**: Export scale (default: 2, max: 4)
- **max_dimension?**: Resize if larger than this (in pixels)
- **Returns**: Base64-encoded PNG image

#### `extract_styles(file_key, page_name, frame_name)`
Exports design tokens (colors, typography, effects) from a frame.
- **Returns**: Colors, text styles, shadows, and other design properties

#### `extract_assets(file_key, page_name, frame_name, output_dir?)`
Exports all SVG and image assets from a frame.
- **output_dir?**: Directory to save assets (default: current directory)
- **Returns**: Organized files in `icons/` and `images/` subdirectories

### Search & Browse

#### `search_components(file_key, query, page_name?, type?, continue?)`
Finds components matching a search query.
- **file_key**: The file ID
- **query**: Search term (e.g., "button", "icon")
- **page_name?**: Limit search to a specific page
- **type?**: Filter by type (component, instance, etc.)
- **continue?**: Fetch more results
- **Returns**: Matching components with paths and metadata

#### `get_file_styles(file_key)`
Lists all published styles (colors, typography) in the file.
- **Returns**: Organized style library

### Session & State Management

#### `repeat_last()`
Instantly replays the previous tool response without making a new API call.
- **Use case**: You asked for a large list, got the first 20 items, and want to review them again
- **Returns**: Cached response from the previous call

#### `get_session_state()`
Shows the current session state, including pagination cursors and cached results.
- **Returns**: Active cursors, cached data, and conversation history

#### `reset_session()`
Clears all cached data and pagination state.
- **Use case**: Start fresh with a new file or reset confused pagination

---

## How It Works: The Continue Pattern

When you request a large list, mcp-server-figma automatically returns **the first 20 items** and tells you there are more available:

```
Frames in "Components" page:
1. Button
2. Card
3. Modal
4. ...
19. Badge
20. Avatar

[20 items shown] More results available. Use continue=true to fetch the next page.
```

To get the next page, simply call the same tool with `continue=true`:

```javascript
list_frames("file_key", "Components", true)  // Fetches items 21-40
```

This pattern:
- **Saves tokens** by not sending huge lists upfront
- **Improves UX** by showing results progressively
- **Respects rate limits** by pacing API calls

---

## Example Workflow

### Scenario: Exporting a design system library

```
1. User: "Show me the components in my Figma file"
   → Tool: list_pages(file_key)
   → Result: ["Home", "Components", "Icons", "Documentation"]

2. User: "Show me all frames on the Components page"
   → Tool: list_frames(file_key, "Components")
   → Result: 45 frames found, showing first 20

3. User: "Get more frames"
   → Tool: list_frames(file_key, "Components", continue=true)
   → Result: Next 20 frames (21-40)

4. User: "Show me the Button component structure"
   → Tool: get_frame_info(file_key, "Components", "Button")
   → Result: Nested structure with all variants and states

5. User: "Export the Button colors and typography"
   → Tool: extract_styles(file_key, "Components", "Button")
   → Result: Design tokens (hex colors, font sizes, line heights)

6. User: "Save all icons as SVG"
   → Tool: extract_assets(file_key, "Icons", "All", "./exported")
   → Result: Files saved to icons/ and images/ folders
```

---

## Rate Limiting

Figma's API has rate limits based on your plan. mcp-server-figma respects these limits and warns you when approaching them.

| Plan | Rate Limit | Concurrent Requests |
|------|-----------|-------------------|
| Free | 120 requests/minute | 5 |
| Professional | 240 requests/minute | 10 |
| Organization | 480 requests/minute | 20 |

**What happens at limits?**
- The server returns a clear error message
- Suggestions for optimization (pagination, batching)
- Automatic retry with exponential backoff for certain endpoints

**Best practices:**
- Use `continue=true` to paginate instead of fetching all at once
- Combine multiple queries into single `get_frame_info()` calls
- Cache results with `get_session_state()` before resetting

---

## Troubleshooting

### "Invalid Figma API token"
- Verify your token in Claude's configuration
- Check that you copied the entire token (no extra spaces)
- Regenerate the token in [Figma Settings](https://figma.com/settings) if needed

### "File not found" or 404 errors
- Ensure you have access to the file (shared or owned)
- Use the full file URL or the 24-character file key
- Check that the page/frame names are spelled exactly as they appear

### "Rate limit exceeded"
- Wait a few seconds and try again
- Use `continue=true` for pagination
- Check `get_session_state()` to see current request count

### Large result sets are slow
- Use pagination with `continue=true` instead of fetching everything at once
- Reduce `depth` in `get_frame_info()` to explore less nesting
- Use `search_components()` to narrow down results first

---

## API Reference

All tools follow this naming convention:
- **snake_case** for tool names
- **snake_case** for parameters
- Results include both human-readable names and technical IDs for flexibility

For detailed type definitions and response schemas, see the [tools documentation](./src/tools/).

---

## License

MIT — Feel free to use, modify, and distribute.

---

**Need help?** [Open an issue](https://github.com/alucardeht/mcp-server-figma/issues) or check the [Figma API docs](https://www.figma.com/developers/api).
