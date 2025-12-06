export const toolSchemas = [
  {
    name: "list_pages",
    description: `List all pages in a Figma file.

HOW IT WORKS:
- Returns compact JSON with page names, IDs, and frame counts
- Large files (>50 pages) are automatically chunked
- Use 'continue: true' to get next batch

TYPICAL WORKFLOW:
1. list_pages → see all pages
2. list_frames(page_name) → see frames in a page
3. get_frame_info(frame_name) → detail one frame`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL (e.g., 'h75vgHNcwxfHkRBbI53RRu')",
        },
        continue: {
          type: "boolean",
          description: "Continue from last response if more pages available",
        },
      },
      required: ["file_key"],
    },
  },
  {
    name: "list_frames",
    description: `List frames/screens in a specific page.

HOW IT WORKS:
- Search by page name (partial match supported)
- Large pages (>50 frames) are automatically chunked
- Returns compact list with frame names, sizes, and IDs
- Session remembers what was sent

TYPICAL WORKFLOW:
1. list_pages → find page name
2. list_frames(page_name) → see frames
3. get_frame_info(frame_name) → detail one frame
4. extract_assets(frame_name) → get assets`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match, case-insensitive)" },
        continue: { type: "boolean", description: "Continue from last response if more frames available" },
      },
      required: ["file_key", "page_name"],
    },
  },
  {
    name: "get_frame_info",
    description: `Get detailed info about a specific frame.

HOW IT WORKS:
- Returns all components, text, colors, and styles
- Large frames (>1000 elements) trigger warning with strategy
- Use depth parameter to control detail level
- Automatically chunks if response too large

TYPICAL WORKFLOW:
1. list_frames → find frame name
2. get_frame_info(frame_name) → structure
3. extract_styles → design tokens
4. extract_assets → icons/images`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match)" },
        frame_name: { type: "string", description: "Frame name (partial match)" },
        depth: {
          type: "number",
          description: "How deep to traverse (1=direct children, 2=grandchildren). Default: 2",
          default: 2,
        },
        continue: { type: "boolean", description: "Continue from last response" },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "get_screenshot",
    description: `Capture screenshot of a frame.

HOW IT WORKS:
- For large frames, automatically segments into tiles
- Returns base64 image(s)
- Scale 1-4 controls resolution

TYPICAL WORKFLOW:
1. list_frames → find frame
2. get_screenshot → visual reference
3. get_frame_info → structure details`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match)" },
        frame_name: { type: "string", description: "Frame name (partial match)" },
        scale: { type: "number", description: "Scale 1-4 (default: 2)", default: 2 },
        max_dimension: { type: "number", description: "Max px before segmenting (default: 4096)", default: 4096 },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "extract_styles",
    description: `Extract all design tokens from a frame.

HOW IT WORKS:
- Collects colors, fonts, spacing, border radius, shadows
- Returns organized JSON ready for CSS/theme generation
- No chunking needed (compact output)

TYPICAL WORKFLOW:
1. get_frame_info → understand structure
2. extract_styles → design tokens
3. Use tokens to build theme/CSS`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match)" },
        frame_name: { type: "string", description: "Frame name (partial match)" },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "extract_assets",
    description: `Extract all assets from a frame with progress tracking.

HOW IT WORKS:
- Automatically categorizes into icons/ and images/
- Uses smart naming based on component hierarchy
- Shows progress: "Processing batch 1/5 - found 8 icons, 3 images"
- Final summary with all file paths

TYPICAL WORKFLOW:
1. get_frame_info → see what assets exist
2. extract_assets → download all
3. Check summary for file paths`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match)" },
        frame_name: { type: "string", description: "Frame name (partial match)" },
        output_dir: { type: "string", description: "Output directory (default: ./figma-assets)", default: "./figma-assets" },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "search_components",
    description: `Search for components by name across the file.

HOW IT WORKS:
- Searches entire file or specific page
- Returns top 20 results with total count
- If >20 results, suggests refinement options
- Use 'continue: true' to get more results

TYPICAL WORKFLOW:
1. search_components(query) → find matches
2. If too many: refine with page_name or type filter
3. get_frame_info on specific result`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        query: { type: "string", description: "Search term (case-insensitive, partial match)" },
        page_name: { type: "string", description: "Limit search to specific page" },
        type: { type: "string", description: "Filter by type: COMPONENT, INSTANCE, FRAME, TEXT, VECTOR" },
        continue: { type: "boolean", description: "Continue from last response for more results" },
      },
      required: ["file_key", "query"],
    },
  },
  {
    name: "get_file_styles",
    description: `Get all published styles defined in the file.

HOW IT WORKS:
- Returns design system tokens: colors, text styles, effects
- These are the official styles defined in Figma
- Compact output, no chunking needed

TYPICAL WORKFLOW:
1. get_file_styles → global design tokens
2. extract_styles(frame) → frame-specific tokens
3. Combine for complete design system`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
      },
      required: ["file_key"],
    },
  },
  {
    name: "repeat_last",
    description: `Repeat the last response without making new API calls.

HOW IT WORKS:
- Returns exact same response from session state
- No Figma API call needed
- Useful for context recovery

WHEN TO USE:
- Lost context and need to see previous data
- Want to reference last response again`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_session_state",
    description: `Get current session state for debugging.

RETURNS:
- Current file being explored
- Pages and frames already sent
- Pending continuation operations
- Last update timestamp`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "reset_session",
    description: `Clear all session state for fresh start.

USE WHEN:
- Switching to different Figma file
- Want to re-explore from scratch
- Session state seems corrupted`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "analyze_page_structure",
    description: `Analyze page structure BEFORE any implementation.

MUST BE CALLED FIRST for any large page/frame.

HOW IT WORKS:
- Identifies sections by background color changes
- Detects transition elements spanning multiple sections
- Groups icons by section
- Estimates token usage
- Recommends agent count for parallel work

RETURNS:
- sections: List with id, name, bgColor, bounds, complexity
- transition_elements: Elements spanning multiple sections
- icons_by_section: Icons organized by section
- total_estimated_tokens: Token estimate for full frame
- recommended_division: 'single' or 'multiple'
- recommended_agent_count: How many agents to use

TYPICAL WORKFLOW:
1. analyze_page_structure → understand structure
2. If recommended_division='multiple': use get_section_screenshot
3. Each agent uses get_agent_context for its section`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL",
        },
        page_name: {
          type: "string",
          description: "Page name (partial match)",
        },
        frame_name: {
          type: "string",
          description: "Frame name (partial match)",
        },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "get_section_screenshot",
    description: `Capture screenshot of a specific section within a frame.

HOW IT WORKS:
- First call analyze_page_structure to identify sections
- Makes other sections transparent (shows only target section)
- Optionally includes transition elements context
- Returns cropped image focused on section
- Useful for parallel analysis of large frames

TYPICAL WORKFLOW:
1. analyze_page_structure → identify sections
2. get_section_screenshot(sectionId) → capture isolated section
3. get_frame_info with section context → implementation details`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL",
        },
        page_name: {
          type: "string",
          description: "Page name (partial match)",
        },
        frame_name: {
          type: "string",
          description: "Frame name (partial match)",
        },
        section_id: {
          type: "string",
          description: "Section ID from analyze_page_structure (e.g., 'section-0')",
        },
        include_transition_context: {
          type: "boolean",
          description: "Include margin context for transition elements (default: true)",
          default: true,
        },
        scale: {
          type: "number",
          description: "Image scale 1-4 (default: 2)",
          default: 2,
        },
      },
      required: ["file_key", "page_name", "frame_name", "section_id"],
    },
  },
  {
    name: "get_agent_context",
    description: `Prepare agent context for parallel implementation of a section.

HOW IT WORKS:
- Call after analyze_page_structure to identify sections
- Returns complete context for a single agent to implement one section
- Handles responsibilities: what to implement vs coordinate
- Includes icons, styles, and transition element info
- Generates agent-specific instructions with coordination rules

RETURNS:
- section: Details (id, name, background color, bounds)
- responsibilities: what agent implements, coordinates, or skips
- assets: icons and images in this section
- styles: colors, fonts, spacing specific to section
- agent_info: index, total agents, is_first, is_last
- instructions: detailed markdown instructions for this agent

TYPICAL WORKFLOW:
1. analyze_page_structure → identify sections
2. For each section: get_section_screenshot → visual reference
3. get_agent_context(sectionId, agentIndex) → agent-specific context
4. Each agent implements using provided context`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL",
        },
        page_name: {
          type: "string",
          description: "Page name (partial match)",
        },
        frame_name: {
          type: "string",
          description: "Frame name (partial match)",
        },
        section_id: {
          type: "string",
          description: "Section ID from analyze_page_structure (e.g., 'section-0')",
        },
        agent_index: {
          type: "number",
          description: "Zero-based agent index (default: 0)",
          default: 0,
        },
        total_agents: {
          type: "number",
          description: "Total number of agents working in parallel (default: 1)",
          default: 1,
        },
      },
      required: ["file_key", "page_name", "frame_name", "section_id"],
    },
  },
  {
    name: "get_full_page_context",
    description: `Get complete page context in ONE call with all sections, assets, screenshots, and styles.

WHAT YOU GET IN ONE CALL:
- Complete page structure with all sections identified
- Screenshots for each section (base64 encoded)
- All assets organized by section with unique names
- Design tokens per section
- Asset map for quick lookup
- Agent instructions ready for parallel implementation
- Transition elements that span multiple sections

PERFECT FOR:
- Getting full context before implementation
- Preparing data for parallel multi-agent work
- Quick assessment of page complexity
- One-call solution for complete page understanding

RETURNS:
- overview: Frame metadata and recommendations
- sections: Array with all section details including screenshots
- assetMap: Quick lookup table for assets by unique name
- agentInstructions: Pre-written instructions for each agent
- transitionElements: Elements spanning multiple sections

TYPICAL WORKFLOW:
1. get_full_page_context → get everything at once
2. Distribute sections to multiple agents using agentInstructions
3. Each agent implements their section with all necessary context`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL",
        },
        page_name: {
          type: "string",
          description: "Page name (partial match)",
        },
        frame_name: {
          type: "string",
          description: "Frame name (partial match)",
        },
        scale: {
          type: "number",
          description: "Screenshot scale 1-4 (default: 2)",
          default: 2,
        },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
];
