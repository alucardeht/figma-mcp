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

IMPORTANT: This should be your FIRST call for any implementation task.
Always call get_frame_info BEFORE taking screenshots to understand the structure.

HOW IT WORKS:
- Returns all components, text, colors, and styles
- Large frames (>1000 elements) trigger warning with strategy
- Use depth parameter to control detail level
- Automatically chunks if response too large

The tree includes special markers:
- isCompositeAsset: true = Export this GROUP as a single image (contains image + shapes)
- isSmallElement: true = Small UI element that may be easily missed

PARAMETER COMBINATIONS:
- Use EITHER node_id directly for fast access
- OR use page_name + frame_name for navigation by hierarchy

TYPICAL WORKFLOW:
1. list_frames → find frame name
2. get_frame_info(page_name, frame_name) → structure
3. extract_styles → design tokens
4. extract_assets → icons/images

ALTERNATIVE WORKFLOW (with node_id):
1. get_frame_info(node_id) → direct access (faster, no page iteration)`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match). Use with frame_name or provide node_id instead." },
        frame_name: { type: "string", description: "Frame name (partial match). Use with page_name or provide node_id instead." },
        node_id: { type: "string", description: "Figma node ID from URL (format: 40000056-28165). Alternative to page_name+frame_name - provides direct fast access." },
        depth: {
          type: "number",
          description: "How deep to traverse (1=direct children, 2=grandchildren). Default: 2",
          default: 2,
        },
        continue: { type: "boolean", description: "Continue from last response" },
      },
      required: ["file_key"]
    },
  },
  {
    name: "get_screenshot",
    description: `Capture screenshot of a frame.

WARNING: Do NOT use screenshots as the first step!
Always call get_frame_info first to understand the structure.
Screenshots are for visual reference AFTER you understand the tree.

HOW IT WORKS:
- For large frames, automatically segments into tiles
- Returns base64 image(s)
- Scale 1-4 controls resolution

PARAMETER COMBINATIONS:
- Use EITHER node_id directly for fast capture
- OR use page_name + frame_name for navigation by hierarchy

TYPICAL WORKFLOW:
1. list_frames → find frame
2. get_frame_info → structure details
3. get_screenshot → visual reference

ALTERNATIVE (with node_id):
1. get_screenshot(node_id) → direct capture (faster)`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "Figma file key" },
        page_name: { type: "string", description: "Page name (partial match). Use with frame_name or provide node_id instead." },
        frame_name: { type: "string", description: "Frame name (partial match). Use with page_name or provide node_id instead." },
        node_id: { type: "string", description: "Figma node ID from URL (format: 40000056-28165). Alternative to page_name+frame_name - provides direct fast capture." },
        scale: { type: "number", description: "Scale 1-4 (default: 2)", default: 2 },
        max_dimension: { type: "number", description: "Max px before segmenting (default: 4096)", default: 4096 },
      },
      required: ["file_key"]
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
- Detects "composite groups" (image + decorative shapes) and exports them as single PNG
- For composite groups, the ENTIRE group is exported as one image, preserving layout
- Automatically categorizes into icons/, images/, and images/composites/
- Uses smart naming based on component hierarchy
- Shows progress: "Processing batch 1/5 - found 8 icons, 3 images, 2 composites"
- Final summary with all file paths
- Look for "isCompositeAsset: true" in the frame tree to identify composite groups

TYPICAL WORKFLOW:
1. get_frame_info → see what assets exist and identify composite groups
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
  {
    name: "check_layout_bounds",
    description: `Detect overflow - child elements extending beyond parent container bounds.

DETECTS:
- Buttons overflowing cards
- Content extending beyond containers
- Layout breaks at specific viewports

PREREQUISITE:
1. Use chrome-devtools.navigate_page(url) to load implementation
2. Use chrome-devtools.resize_page(width, height) to match Figma viewport
3. Use chrome-devtools.take_snapshot() or evaluate_script to get element bounds
4. Extract bounds as {selector: {x, y, width, height}} object

RETURNS:
- status: PASS/FAIL/WARNING
- issues: Array with severity, element, overflow_px, direction
- fix_suggestions: CSS hints to resolve overflows

EXAMPLE:
check_layout_bounds({
  parent_selector: ".form-card",
  child_selectors: [".btn-submit", ".input-cep"],
  browser_bounds: {
    ".form-card": {x: 100, y: 200, width: 400, height: 120},
    ".btn-submit": {x: 480, y: 220, width: 120, height: 40}
  }
})
→ FAIL: ".btn-submit overflows container by 100px on the right"`,
    inputSchema: {
      type: "object",
      properties: {
        parent_selector: {
          type: "string",
          description: "CSS selector for the container element"
        },
        child_selectors: {
          type: "array",
          items: { type: "string" },
          description: "CSS selectors for child elements to check"
        },
        browser_bounds: {
          type: "object",
          description: "Map of selector → {x, y, width, height} from browser. Get via chrome-devtools snapshot or evaluate_script."
        },
        tolerance_px: {
          type: "number",
          default: 2,
          description: "Tolerance in pixels for minor rounding differences (default: 2)"
        }
      },
      required: ["parent_selector", "child_selectors", "browser_bounds"]
    }
  },
  {
    name: "compare_element_position",
    description: `Compare element position between Figma design and browser implementation.

USE WHEN:
- Validating element placement
- Checking alignment issues
- Verifying responsive positioning

PREREQUISITE:
1. Get expected position from Figma via get_frame_info
2. Get actual position from browser via chrome-devtools

RETURNS:
- status: PASS/FAIL
- deviation: {x, y} difference in pixels
- within_tolerance: boolean`,
    inputSchema: {
      type: "object",
      properties: {
        element_selector: {
          type: "string",
          description: "CSS selector for the element"
        },
        figma_position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          description: "Expected position from Figma"
        },
        browser_position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          description: "Actual position from browser"
        },
        relative_to: {
          type: "string",
          description: "Optional: selector of reference element for relative positioning"
        },
        tolerance_px: {
          type: "number",
          default: 5,
          description: "Tolerance in pixels (default: 5)"
        }
      },
      required: ["element_selector", "figma_position", "browser_position"]
    }
  },
  {
    name: "compare_element_dimensions",
    description: `Compare element size between Figma design and browser implementation.

USE WHEN:
- Validating element sizing
- Checking responsive scaling
- Verifying component dimensions

RETURNS:
- status: PASS/FAIL
- diff: {width, height} difference in pixels
- deviation_percent: percentage difference`,
    inputSchema: {
      type: "object",
      properties: {
        element_selector: {
          type: "string",
          description: "CSS selector for the element"
        },
        figma_dimensions: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Expected dimensions from Figma"
        },
        browser_dimensions: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Actual dimensions from browser"
        },
        tolerance_percent: {
          type: "number",
          default: 2,
          description: "Tolerance as percentage (default: 2%)"
        }
      },
      required: ["element_selector", "figma_dimensions", "browser_dimensions"]
    }
  },
  {
    name: "compare_visual",
    description: `Compare visual appearance between Figma export and browser screenshot using pixel-by-pixel analysis.

PERFECT FOR:
- Final visual validation before deployment
- Detecting color, spacing, and font rendering issues
- Comprehensive pixel-level comparison
- Identifying problematic UI regions

HOW IT WORKS:
- Compares Figma frame screenshot with browser screenshot
- Uses pixelmatch for pixel-accurate analysis
- Identifies problematic regions (9-grid analysis)
- Returns match score and fix recommendations
- Does NOT return images (token-efficient)

PREREQUISITES:
1. Navigate to implementation in browser using chrome-devtools
2. Resize viewport to exact Figma frame dimensions
3. Take browser screenshot with chrome-devtools
4. Call get_frame_info or get_screenshot to cache frame data

RETURNS:
- status: PASS/FAIL/ERROR
- match_score: Visual match percentage (0-100)
- mismatched_pixels: Total pixels that don't match
- problematic_regions: Array with severity, location, and causes
- recommendations: Specific fixes for failed regions
- warnings: Dimension mismatches or other issues

EXAMPLE:
compare_visual({
  figma_file_key: "abc123def",
  figma_frame_name: "Home Hero",
  browser_screenshot_base64: "iVBORw0KGg...",
  viewport: {width: 1920, height: 1080},
  pass_threshold: 95
})
→ match_score: 92.3%, status: FAIL
→ Regions: "top-left: 15% mismatch (header colors differ)", "center: 8% mismatch (spacing)"`,
    inputSchema: {
      type: "object",
      properties: {
        figma_file_key: {
          type: "string",
          description: "Figma file key from URL"
        },
        figma_frame_name: {
          type: "string",
          description: "Frame name to compare against (partial match)"
        },
        figma_node_id: {
          type: "string",
          description: "Alternative: specific node ID instead of frame name"
        },
        browser_screenshot_base64: {
          type: "string",
          description: "Base64 encoded browser screenshot (from chrome-devtools.take_screenshot)"
        },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Viewport dimensions that screenshot was taken at (must match Figma frame)"
        },
        threshold: {
          type: "number",
          default: 0.1,
          description: "Pixel difference threshold 0-1 (default: 0.1, lower = stricter)"
        },
        pass_threshold: {
          type: "number",
          default: 90,
          description: "Match percentage needed to PASS (default: 90%)"
        }
      },
      required: ["figma_file_key", "browser_screenshot_base64", "viewport"]
    }
  },
  {
    name: "verify_elements_present",
    description: `Verify that expected elements exist in the browser DOM.

USE WHEN:
- Checking if all Figma elements were implemented
- Validating component completeness
- Finding missing UI elements

PREREQUISITE:
1. Use chrome-devtools.take_snapshot() to get browser DOM state
2. Prepare list of expected elements with CSS selectors

RETURNS:
- status: PASS/FAIL
- found/missing counts
- Per-element status with suggestions`,
    inputSchema: {
      type: "object",
      properties: {
        expected_elements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector for the element" },
              description: { type: "string", description: "Human-readable description" },
              required: { type: "boolean", default: true, description: "Whether element is required" }
            },
            required: ["selector"]
          },
          description: "Array of elements to check for"
        },
        browser_snapshot: {
          type: ["object", "string"],
          description: "DOM snapshot from chrome-devtools.take_snapshot()"
        }
      },
      required: ["expected_elements", "browser_snapshot"]
    }
  },
  {
    name: "verify_assets_loaded",
    description: `Verify that image/icon assets are properly loaded (not 404, not broken).

DETECTS:
- Broken images (naturalWidth = 0)
- Placeholder images (1x1 pixels)
- Failed background images
- Missing SVG icons

PREREQUISITE:
1. Use chrome-devtools.evaluate_script() to get asset info:
   For images: {naturalWidth, naturalHeight, complete, src}
   For backgrounds: {backgroundImage}
   For icons: {tagName, innerHTML, fontFamily}

RETURNS:
- status: PASS/FAIL
- loaded/broken counts
- Per-asset status with issue details`,
    inputSchema: {
      type: "object",
      properties: {
        asset_checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector for the asset element" },
              type: { type: "string", enum: ["image", "background", "icon"], default: "image" },
              description: { type: "string", description: "Human-readable description" }
            },
            required: ["selector"]
          },
          description: "Array of assets to verify"
        },
        browser_asset_info: {
          type: "object",
          description: "Map of selector → asset info from browser. Get via chrome-devtools.evaluate_script()"
        }
      },
      required: ["asset_checks", "browser_asset_info"]
    }
  },
  {
    name: "validate_responsive_breakpoint",
    description: `Validate implementation at a specific viewport breakpoint.
Aggregates results from multiple validation tools for comprehensive check.

USE WHEN:
- Testing specific viewport (mobile, tablet, desktop)
- Combining multiple validations into single report
- Checking responsive behavior

PREREQUISITE:
Run these validations at the target viewport first:
1. check_layout_bounds
2. verify_elements_present
3. verify_assets_loaded
4. compare_visual (optional)

Then pass all results to this tool.

RETURNS:
- Overall status for breakpoint
- Aggregated validation results
- Priority fixes list`,
    inputSchema: {
      type: "object",
      properties: {
        breakpoint_name: {
          type: "string",
          description: "Name of breakpoint (e.g., 'mobile', 'tablet', 'desktop')"
        },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" }
          },
          required: ["width"],
          description: "Viewport dimensions"
        },
        figma_frame_name: {
          type: "string",
          description: "Name of corresponding Figma frame for this breakpoint"
        },
        validation_results: {
          type: "object",
          description: "Results from other validations: {layout_bounds, elements_present, assets_loaded, visual}"
        }
      },
      required: ["viewport", "validation_results"]
    }
  },
  {
    name: "test_all_breakpoints",
    description: `Test multiple viewport breakpoints and aggregate results.
Provides comprehensive responsive validation report.

USE WHEN:
- Testing full responsive behavior
- Final validation before completion
- Generating responsive test report

PREREQUISITE:
Run validations at each breakpoint first, then pass all results.

RETURNS:
- Overall responsive status
- Per-breakpoint results
- Recommendations for failing breakpoints`,
    inputSchema: {
      type: "object",
      properties: {
        breakpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Breakpoint name" },
              width: { type: "number", description: "Viewport width" },
              height: { type: "number", description: "Viewport height (optional)" },
              figma_frame: { type: "string", description: "Corresponding Figma frame name" }
            },
            required: ["width"]
          },
          description: "Array of breakpoints to test"
        },
        validation_results_by_breakpoint: {
          type: "object",
          description: "Map of breakpoint name/width → validation results"
        }
      },
      required: ["breakpoints", "validation_results_by_breakpoint"]
    }
  }
];
