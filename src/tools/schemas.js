export const toolSchemas = [
  {
    name: "list_pages",
    description: `List all pages in a Figma file. Returns page names, IDs, and frame counts. Large files (>50 pages) auto-chunk; use continue:true for next batch.`,
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
    description: `List frames/screens in a specific page by name (partial match). Returns frame names, sizes, IDs. Large pages (>50 frames) auto-chunk; use continue:true.`,
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
    description: `Get detailed frame info (components, text, colors, styles). Call FIRST before screenshots. Use node_id for fast access OR page_name+frame_name. Depth param controls detail level.`,
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
    description: `Capture frame screenshot. WARNING: Call get_frame_info FIRST. Returns base64 image(s). Use node_id for fast access OR page_name+frame_name. Scale 1-4 controls resolution.`,
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
    description: `Extract design tokens from frame (colors, fonts, spacing, radius, shadows). Returns JSON ready for CSS/theme generation. Compact output, no chunking.`,
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
    description: `Extract all assets from frame with progress tracking. Detects composite groups (isCompositeAsset:true) and exports as single PNG. Categorizes into icons/, images/, composites/.`,
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
    description: `Search components by name across file or specific page. Returns top 20 results. Use continue:true for more, or refine with page_name/type filter.`,
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
    description: `Get all published file styles (colors, text styles, effects). Returns official Figma design system tokens. Compact output, no chunking.`,
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
    description: `Repeat last response without new API calls. Returns cached session state. Use for context recovery or re-referencing previous data.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_session_state",
    description: `Get current session state for debugging. Returns current file, pages/frames sent, pending operations, and last update timestamp.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "reset_session",
    description: `Clear all session state for fresh start. Use when switching files, re-exploring from scratch, or fixing corrupted state.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "analyze_page_structure",
    description: `Analyze page structure BEFORE implementation. Identifies sections by bg color, detects transitions, groups icons, estimates tokens, recommends agent count for parallel work.`,
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
    description: `Capture section screenshot within frame. Call analyze_page_structure first. Makes other sections transparent, returns cropped image. Optional transition elements context.`,
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
    description: `Prepare agent context for parallel section implementation. Call after analyze_page_structure. Returns section details, responsibilities, assets, styles, and agent-specific instructions.`,
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
    description: `Get complete page context in ONE call with lazy loading support. Returns sections, styles (default), and optional screenshots, assets, agent instructions. Perfect for parallel multi-agent work and quick complexity assessment.`,
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
        include_screenshots: {
          type: "boolean",
          description: "Include base64 screenshots for each section (default: false, saves bandwidth)",
          default: false,
        },
        include_assets: {
          type: "boolean",
          description: "Include full asset objects with export URLs (default: false, only counts if false)",
          default: false,
        },
        include_styles: {
          type: "boolean",
          description: "Include design tokens: colors, fonts, spacing, shadows (default: true)",
          default: true,
        },
        include_agent_instructions: {
          type: "boolean",
          description: "Include detailed instructions for agents (default: false)",
          default: false,
        },
        include_asset_map: {
          type: "boolean",
          description: "Include consolidated asset map (only used with include_assets=true, default: false)",
          default: false,
        },
      },
      required: ["file_key", "page_name", "frame_name"],
    },
  },
  {
    name: "check_layout_bounds",
    description: `Detect overflow: child elements extending beyond parent bounds. Requires browser_bounds from chrome-devtools. Returns status, issues array, fix suggestions.`,
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
    description: `Compare element position between Figma and browser. Returns status (PASS/FAIL), deviation in pixels, within_tolerance boolean. Default tolerance: 5px.`,
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
    description: `Compare element dimensions between Figma and browser. Returns status (PASS/FAIL), diff in pixels, deviation_percent. Default tolerance: 2%.`,
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
    name: "validate_layout",
    description: `Unified layout validation: overflow detection, position comparison, or dimension comparison. Set validation_type to choose the validation strategy.`,
    inputSchema: {
      type: "object",
      properties: {
        validation_type: {
          type: "string",
          enum: ["overflow", "position", "dimensions"],
          description: "Type: 'overflow' (child extends parent), 'position' (x,y comparison), 'dimensions' (width,height comparison)"
        },
        parent_selector: {
          type: "string",
          description: "For overflow: parent CSS selector"
        },
        child_selectors: {
          type: "array",
          items: { type: "string" },
          description: "For overflow: child CSS selectors"
        },
        browser_bounds: {
          type: "object",
          description: "For overflow/position/dimensions: map of selector → {x, y, width, height}"
        },
        tolerance_px: {
          type: "number",
          description: "For overflow/position: pixel tolerance (default: 2 for overflow, 5 for position)"
        },
        element_selector: {
          type: "string",
          description: "For position/dimensions: element CSS selector"
        },
        figma_position: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          description: "For position: expected position from Figma"
        },
        browser_position: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          description: "For position: actual position from browser"
        },
        relative_to: {
          type: "string",
          description: "For position: reference element selector"
        },
        figma_dimensions: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } },
          description: "For dimensions: expected dimensions from Figma"
        },
        browser_dimensions: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } },
          description: "For dimensions: actual dimensions from browser"
        },
        tolerance_percent: {
          type: "number",
          description: "For dimensions: percentage tolerance (default: 2)"
        }
      },
      required: ["validation_type"]
    }
  },
  {
    name: "compare_visual",
    description: `Pixel-by-pixel visual comparison between Figma and browser screenshots. Returns match_score (0-100), status, problematic regions (9-grid), fix recommendations. Default pass: 90%.`,
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
    description: `Verify expected elements exist in browser DOM. Requires browser_snapshot from chrome-devtools. Returns status, found/missing counts, per-element suggestions.`,
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
    description: `Verify image/icon assets loaded correctly (not 404/broken). Detects broken images, placeholders, failed backgrounds, missing SVG. Returns status, counts, per-asset details.`,
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
    name: "verify_implementation_v2",
    description: `Unified implementation verification: check DOM elements exist OR check assets loaded correctly. Set verification_type to choose the verification strategy.`,
    inputSchema: {
      type: "object",
      properties: {
        verification_type: {
          type: "string",
          enum: ["elements", "assets"],
          description: "Type: 'elements' (DOM presence verification) or 'assets' (image/icon loading verification)"
        },
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
          description: "For elements: array of elements to check for"
        },
        browser_snapshot: {
          type: ["object", "string"],
          description: "For elements: DOM snapshot from chrome-devtools.take_snapshot()"
        },
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
          description: "For assets: array of assets to verify"
        },
        browser_asset_info: {
          type: "object",
          description: "For assets: map of selector → asset info from browser. Get via chrome-devtools.evaluate_script()"
        }
      },
      required: ["verification_type"]
    }
  },
  {
    name: "validate_responsive_breakpoint",
    description: `Validate implementation at specific breakpoint. Aggregates results from check_layout_bounds, verify_elements_present, verify_assets_loaded, compare_visual. Returns overall status and priority fixes.`,
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
    description: `Test multiple breakpoints and aggregate results. Provides comprehensive responsive validation report. Returns overall status, per-breakpoint results, recommendations.`,
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
  },
  {
    name: "validate_implementation",
    description: `Validate browser implementation against Figma in ONE call with pixel-perfect visual comparison.

WHAT IT DOES:
- Captures live browser screenshot via Chrome DevTools Protocol (CDP)
- Fetches corresponding frame image from Figma
- Compares pixel-by-pixel with configurable threshold
- Returns PASS/FAIL status with match score, problematic regions, and recommendations

REQUIREMENTS:
- Chrome running with --remote-debugging-port (default: 9222)
- URL must be accessible from your machine
- Figma node/frame must exist and be visible

NODE ID FORMATS:
- URL format: '123-456' (from Figma URL)
- API format: '123:456' (accepts both, auto-converts)
- Alternative: page_name + figma_frame_name for frame lookup

VIEWPORT:
- Optional if frame has absoluteBoundingBox (auto-detected from Figma)
- Required if frame dimensions unknown
- Must match actual browser viewport for accurate comparison

RETURN VALUES:
- PASS: match_score >= pass_threshold (default 90%)
- FAIL: match_score < pass_threshold, includes problematic_regions (9-grid) and recommendations
- ERROR: Chrome unavailable, frame not found, or image comparison failed

USAGE TIPS:
1. Call get_frame_info first to verify frame exists and get dimensions
2. Use figma_node_id for fastest access (no page/frame name searching)
3. For responsive testing, call with different viewport sizes
4. Adjust threshold (0-1) for stricter/looser pixel comparison

RETURN STRUCTURE:
Results are automatically organized by visual sections (detected by background color):
- status: PASS | FAIL | PARTIAL
- overall_score: averaged match_score across all sections (0-100)
- sections[]: array of detected visual sections, each containing:
  * id: section identifier
  * name: descriptive section name
  * status: section-level validation status
  * match_score: pixel-perfect match percentage for this section
  * bounds: {x, y, width, height} coordinates
  * bgColor: section background color
  * css_tree: hierarchical CSS structure of elements in section
  * problems[]: list of detected mismatches
  * recommendations[]: suggestions to fix issues
- dependencies[]: elements that cross multiple sections
- implementation_order[]: suggested build sequence for sections
- legend: field explanations and color codes`,
    inputSchema: {
      type: "object",
      properties: {
        file_key: {
          type: "string",
          description: "Figma file key from URL (e.g., 'h75vgHNcwxfHkRBbI53RRu')"
        },
        url: {
          type: "string",
          description: "URL to validate (e.g., http://localhost:3000)"
        },
        figma_node_id: {
          type: "string",
          description: "Figma node ID (format: '123:456' or '123-456'). Preferred - fastest method."
        },
        page_name: {
          type: "string",
          description: "Page name for frame lookup (partial match, case-insensitive). Use with figma_frame_name."
        },
        figma_frame_name: {
          type: "string",
          description: "Frame name for lookup (partial match, case-insensitive). Use with page_name."
        },
        viewport: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" }
          },
          description: "Viewport dimensions (width required, height optional). If omitted, auto-detected from Figma frame."
        },
        cdp_port: {
          type: "number",
          description: "Chrome DevTools Protocol port (default: 9222)",
          default: 9222
        },
        threshold: {
          type: "number",
          description: "Pixel difference threshold 0-1 (default: 0.1, lower = stricter)",
          default: 0.1
        },
        pass_threshold: {
          type: "number",
          description: "Match percentage to pass (default: 90)",
          default: 90
        }
      },
      required: ["file_key", "url"]
    }
  }
];
