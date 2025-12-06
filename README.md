# @alucardeht/figma-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP server for Figma API with intelligent context management and token optimization.**

v3.0.0 — Compact tree output format with 95% token savings.

---

## Installation

### Claude Code

```bash
claude mcp add figma -e FIGMA_API_TOKEN=your-token-here -- npx -y github:alucardeht/figma-mcp
```

### Get your Figma Token

1. Open [Figma Settings](https://figma.com/settings)
2. Navigate to **Personal access tokens**
3. Click **Create a new token**
4. Copy the token immediately (it won't be shown again)

---

## Requirements

### Figma Plan

The Figma REST API works with any plan, but **rate limits differ significantly**:

| Plan | File Access | Rate Limit |
|------|-------------|------------|
| **Starter (Free)** | 6 requests/month | Impractical for real use |
| **Professional** | Unlimited | 120 req/min |
| **Organization** | Unlimited | 480 req/min |

**Important:** Free accounts are limited to **6 API calls per month** for file content. This makes the MCP server impractical without a paid plan.

Dev Mode is **not required** — this MCP uses the REST API, not Dev Mode features.

---

## Features

### Compact Tree Output (NEW in v3.0)
- **95% token reduction**: 205k chars → 10k chars for typical landing pages
- **ASCII tree format**: Clear hierarchical structure with `├─`, `└─`, `│`
- **Essential info preserved**: Positions, dimensions, colors, layouts, overflow indicators

Example output:
```
Landing page [1440x2462 bg:#f2f2f2]
├─ header [1440x469]
│  ├─ nav [1440x81 row gap:99]
│  │  ├─ logo [155x30 INSTANCE]
│  │  └─ navHeaderLinks [456x49 row gap:8]
│  └─ zipCode [1188x147 bg:#fff radius:20]
├─ aboutContainer [1169x122 row]
│  ├─ aboutBox [391x122 radius:25]
│  └─ aboutBox [408x122 radius:25]
└─ footer [1440x90 row gap:309]
```

### Smart Navigation
- **Name-based access**: Use human-readable names, no IDs required
- **Partial matching**: "Landing" matches "Landing page"
- **Session state**: Maintains context across requests

### Asset Management
- **Organized extraction**: Assets saved to `icons/` and `images/` folders
- **Design tokens**: Extract colors, typography, effects
- **Configurable screenshots**: Scale 1-4x with dimension limits

---

## Available Tools

### Navigation

| Tool | Description |
|------|-------------|
| `list_pages(file_key)` | List all pages in a file |
| `list_frames(file_key, page_name)` | List frames on a page |
| `get_frame_info(file_key, page_name, frame_name, depth?)` | Get frame structure in compact format |
| `search_components(file_key, query)` | Find components by name |

### Extraction

| Tool | Description |
|------|-------------|
| `get_screenshot(file_key, page_name, frame_name)` | Export frame as PNG |
| `extract_styles(file_key, page_name, frame_name)` | Extract design tokens |
| `extract_assets(file_key, page_name, frame_name)` | Export SVGs and images |
| `get_file_styles(file_key)` | List published styles |

### Session

| Tool | Description |
|------|-------------|
| `repeat_last()` | Replay previous response from cache |
| `get_session_state()` | View current session state |
| `reset_session()` | Clear all cached data |

---

## Compact Format Reference

The `get_frame_info` tool returns a compact tree format optimized for LLM context:

```
element-name [[x,y wxh] attributes]
├─ child [[x,y wxh] attributes]
│  └─ grandchild [wxh attributes]
└─ sibling [wxh attributes]
```

**Attributes shown:**
- `bg:#hex` — Background color
- `row` / `col` — Layout direction
- `gap:N` — Spacing between children
- `radius:N` — Border radius
- `shadow` — Has drop shadow
- `INSTANCE` / `VECTOR` / `TEXT` — Node type
- `↓overflow:Npx` — Content overflows bounds

---

## Example Workflow

```
1. list_pages("h75vgHNcwxfHkRBbI53RRu")
   → ["Home", "Components", "-> Validado"]

2. list_frames(file_key, "Validado")
   → ["Landing page", "Login", "Dashboard"]

3. get_frame_info(file_key, "Validado", "Landing page", depth=4)
   → Compact tree with full structure (165 lines, ~2.5k tokens)

4. extract_assets(file_key, "Validado", "Landing page")
   → icons/icon-1.svg, icons/icon-2.svg, images/hero.png
```

---

## Rate Limits

| Plan | Requests/min |
|------|-------------|
| Free | 120 |
| Professional | 240 |
| Organization | 480 |

Use pagination with `continue=true` to stay within limits.

---

## License

MIT

---

**Issues?** [Open an issue](https://github.com/alucardeht/figma-mcp/issues)
