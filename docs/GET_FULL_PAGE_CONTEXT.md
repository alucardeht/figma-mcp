# get_full_page_context Tool

## Overview

`get_full_page_context` is a comprehensive tool that combines ALL necessary context in a single call for complete page understanding and parallel multi-agent implementation.

## What It Does

With ONE call, you receive:

1. **Complete Page Structure** - All sections identified with metadata
2. **Section Screenshots** - Base64 encoded PNG for each section
3. **Organized Assets** - Icons and images with unique, identifier names
4. **Design Tokens** - Colors, fonts, spacing per section
5. **Quick Lookup Map** - Asset map for fast reference
6. **Agent Instructions** - Pre-written markdown for parallel workers
7. **Transition Elements** - Elements spanning multiple sections

## API Signature

```javascript
getFullPageContext(fileKey, pageName, frameName, scale = 2)
```

### Parameters

- `file_key` (string, required): Figma file key from URL
- `page_name` (string, required): Page name (partial match supported)
- `frame_name` (string, required): Frame name (partial match supported)
- `scale` (number, optional): Screenshot resolution multiplier (1-4, default: 2)

## Response Structure

```javascript
{
  overview: {
    frameName: "Landing Page",
    frameSize: { width: 1440, height: 5000 },
    sectionCount: 5,
    totalAssets: { icons: 15, images: 8 },
    recommendedAgents: 3,
    transitionElementCount: 2
  },

  sections: [
    {
      id: "section-0",
      name: "Hero",
      bgColor: "#FFFFFF",
      bounds: {
        x: 0,
        y: 0,
        width: 1440,
        height: 800
      },

      // Base64 encoded PNG screenshot
      screenshot: "iVBORw0KGgoAAAANSUhEUgAA...",

      assets: {
        icons: [
          {
            id: "123:456",
            uniqueName: "hero-navbar-logo",
            originalName: "Logo",
            path: ["Hero", "NavBar", "Logo"],
            bounds: { x: 50, y: 20, width: 40, height: 40 },
            exportUrl: "https://api.figma.com/v1/images/..."
          }
        ],
        images: [
          {
            id: "789:012",
            uniqueName: "hero-main-banner-bg",
            originalName: "Banner",
            path: ["Hero", "MainSection", "Background"],
            bounds: { x: 0, y: 100, width: 1440, height: 700 },
            exportUrl: "https://api.figma.com/v1/images/..."
          }
        ]
      },

      styles: {
        colors: ["#FFFFFF", "#000000", "#F0F0F0"],
        fonts: ["Inter-Bold-24", "Inter-Regular-16"],
        fontSizes: [16, 24],
        borderRadii: [0, 4, 8],
        spacing: [16, 24, 32],
        shadows: []
      },

      mainElements: [
        { name: "NavBar", type: "FRAME", childCount: 8 },
        { name: "HeroTitle", type: "TEXT" }
      ]
    },
    // ... more sections
  ],

  // Fast lookup table
  assetMap: {
    "hero-navbar-logo": {
      sectionId: "section-0",
      type: "icon",
      exportUrl: "https://api.figma.com/v1/images/..."
    },
    "about-feature1-check": {
      sectionId: "section-1",
      type: "icon",
      exportUrl: "https://api.figma.com/v1/images/..."
    }
    // ... more assets
  },

  // Ready-to-use instructions
  agentInstructions: [
    "# Agent 0 - Hero Section\n\n## Section Details\n- Name: Hero\n- Position: Section 1 of 3\n- Background: #FFFFFF\n- Size: 1440x800px\n\n## Available Assets\n**Icons (4):**\n- hero-navbar-logo: 40x40px\n- hero-cta-arrow: 24x24px\n...",
    "# Agent 1 - About Section\n\n...",
    "# Agent 2 - Features Section\n\n..."
  ],

  transitionElements: [
    {
      id: "456:789",
      name: "FixedHeader",
      type: "FRAME",
      bounds: { x: 0, y: 0, width: 1440, height: 80 },
      spansSections: ["section-0", "section-1"]
    }
  ]
}
```

## Usage Examples

### Example 1: Get Full Context

```typescript
const result = await mcp.callTool("get_full_page_context", {
  file_key: "h75vgHNcwxfHkRBbI53RRu",
  page_name: "Landing",
  frame_name: "Desktop"
});

// result contains everything needed for implementation
console.log("Recommended agents:", result.overview.recommendedAgents);
console.log("Total sections:", result.sections.length);
console.log("Total assets:", result.overview.totalAssets);
```

### Example 2: Parallel Implementation Setup

```typescript
const context = await mcp.callTool("get_full_page_context", {
  file_key: "h75vgHNcwxfHkRBbI53RRu",
  page_name: "Homepage",
  frame_name: "Desktop"
});

// Distribute to agents
for (let i = 0; i < context.overview.recommendedAgents; i++) {
  const section = context.sections[i];
  const instructions = context.agentInstructions[i];

  // Send to agent for implementation
  await agent.implement({
    instructions,
    section,
    assetMap: context.assetMap,
    screenshot: section.screenshot
  });
}
```

### Example 3: Asset Lookup

```typescript
const context = await mcp.callTool("get_full_page_context", {
  file_key: "h75vgHNcwxfHkRBbI53RRu",
  page_name: "Homepage",
  frame_name: "Desktop"
});

// Quickly find any asset
const logoInfo = context.assetMap["hero-navbar-logo"];
console.log("Logo is in:", logoInfo.sectionId);
console.log("Export URL:", logoInfo.exportUrl);
```

## Key Features

### 1. Unique Asset Names
- Each asset has a globally unique `uniqueName` like `hero-navbar-logo`
- Format: `{sectionName}-{parentName}-{assetName}-{index?}`
- Easy to reference and identify
- Collision detection and numbering for duplicates

### 2. Screenshots Per Section
- Base64 encoded PNG for visual reference
- Scale parameter (1-4) for resolution control
- Ready to display or process
- Maintains section context with margins

### 3. Complete Asset Organization
- Icons and images separated
- Organized by section
- Full path information
- Figma export URLs included
- Bounds and dimensions included

### 4. Design Tokens
- Collected per section
- Ready for CSS/theme generation
- Includes colors, fonts, spacing, shadows
- Sorted for consistency

### 5. Agent Instructions
- One instruction string per section
- Includes responsibilities
- Asset list with names
- Design tokens reference
- Coordination rules

### 6. Asset Map
- Fast O(1) lookup by unique name
- Maps to section ID and export URL
- Useful for cross-referencing
- Simplifies asset resolution

## Performance Considerations

### Screenshot Generation
- Screenshots are captured in parallel for all sections
- Falls back gracefully if image generation fails
- Uses configurable scale parameter
- Automatic chunking for large frames

### Asset Collection
- Traverses all children once
- Builds unique names incrementally
- Detects duplicates automatically
- O(n) complexity

### Token Estimation
- Includes frame size: ~1000 tokens
- Per element: ~15 tokens
- Suitable for parallel agents

## Error Handling

The tool throws errors for:
- Page not found
- Frame not found
- Invalid file key
- API failures (with graceful fallbacks)

## When to Use

### Best For:
- Getting complete page understanding in one call
- Preparing context for parallel multi-agent work
- Quick assessment of page complexity
- Asset inventory and validation
- Design system extraction

### Not Ideal For:
- Simple single-section pages (use `get_frame_info` instead)
- Real-time updates (results are snapshots)
- Very large files (may take longer due to screenshot generation)

## Workflow Comparison

### Traditional Multi-Call
1. `analyze_page_structure` → section list
2. `get_section_screenshot` → for each section
3. `extract_assets` → all assets
4. `extract_styles` → design tokens
5. `get_agent_context` → for each section
**= 5+ calls minimum**

### New One-Call Approach
1. `get_full_page_context` → everything
**= 1 call, same result**

## Implementation Details

### Section Grouping
- Uses background color detection
- Identifies gaps between sections
- Infers section names from content
- Handles nested structures

### Asset Detection
- Icons: Small vectors, branded names
- Images: Large rectangles with image fills
- Path tracking for hierarchy
- Deduplication by hierarchy

### Screenshot Extraction
- Full frame capture at desired scale
- Crops to section bounds
- Includes transition context
- Returns base64 PNG

### Token Collection
- Recursive traversal
- Set deduplication
- Sorted output
- Shadow deep collection

## Response Chunking

For very large pages, responses may be chunked if they exceed token limits. The tool includes:
- Step indicator ("Full page context prepared")
- Progress summary
- Next step recommendation
- Strategy explanation

## Examples with Real Scenarios

### Landing Page Analysis
```typescript
// 5-section landing page with hero, features, pricing, testimonials, CTA
const context = await mcp.callTool("get_full_page_context", {
  file_key: "abc123",
  page_name: "Marketing",
  frame_name: "Hero-to-Footer"
});

console.log(context.overview);
// {
//   sectionCount: 5,
//   totalAssets: { icons: 23, images: 8 },
//   recommendedAgents: 3,
//   ...
// }

// Each agent gets full context
agents.forEach((agent, i) => {
  agent.implement(context.sections[i], context.agentInstructions[i]);
});
```

### Asset Extraction and Validation
```typescript
const context = await mcp.callTool("get_full_page_context", {
  file_key: "xyz789",
  page_name: "Design System",
  frame_name: "Components"
});

// Validate all asset names are unique
const names = new Set();
for (const [name, info] of Object.entries(context.assetMap)) {
  if (names.has(name)) {
    console.error("Duplicate asset name:", name);
  }
  names.add(name);
}
```

## Troubleshooting

### Empty Screenshots
- Screenshot generation may fail for some sections
- Falls back to null gracefully
- Check Figma API availability
- Ensure file has render permissions

### Duplicate Asset Names
- Indicates naming conflicts
- Check section/parent names
- Look for pattern duplicates
- Index suffix added automatically

### Large Response Sizes
- Screenshots increase response size
- Use scale=1 for smaller images
- Or use separate `get_section_screenshot` calls
- Response chunking handles large data

## Integration with Other Tools

### With `get_agent_context`
- `get_full_page_context` provides complete overview
- `get_agent_context` provides detailed section context
- Use both for maximum detail

### With `analyze_page_structure`
- `get_full_page_context` includes structure analysis
- Returns richer detail with screenshots and assets
- One-call vs. multi-call tradeoff

### With Extract Tools
- Assets are already organized
- Styles are already extracted
- Screenshots already captured
- No need for separate extract calls

## Future Enhancements

Potential additions:
- Component instances tracking
- Constraint information
- Animation specifications
- Responsive breakpoint variants
- Design system token references
