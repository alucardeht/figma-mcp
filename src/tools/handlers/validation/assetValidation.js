export async function verifyElementsPresent(ctx, args) {
  const { chunker } = ctx;
  const {
    expected_elements,
    browser_snapshot
  } = args;

  if (!expected_elements || !Array.isArray(expected_elements)) {
    throw new Error('expected_elements must be an array of {selector, description}');
  }

  if (!browser_snapshot) {
    throw new Error('browser_snapshot is required - get it from chrome-devtools.take_snapshot()');
  }

  const results = [];
  let foundCount = 0;
  let missingCount = 0;

  for (const element of expected_elements) {
    const { selector, description, required = true } = element;

    const found = checkElementInSnapshot(browser_snapshot, selector);

    if (found) {
      foundCount++;
      results.push({
        selector,
        description,
        status: "found",
        required
      });
    } else {
      if (required) missingCount++;
      results.push({
        selector,
        description,
        status: "missing",
        required,
        suggestion: `Element "${selector}" not found. Check if: 1) selector matches implementation, 2) element is rendered at current viewport, 3) element is not hidden by CSS`
      });
    }
  }

  const status = missingCount > 0 ? "FAIL" : "PASS";

  const result = {
    status,
    total: expected_elements.length,
    found: foundCount,
    missing: missingCount,
    elements: results,
    summary: missingCount > 0
      ? `${missingCount} required element(s) missing from DOM`
      : `All ${foundCount} expected elements found`
  };

  if (missingCount > 0) {
    result.fix_suggestions = [
      "Verify CSS selectors match your implementation",
      "Check if elements are conditionally rendered",
      "Ensure elements are not hidden with display:none or visibility:hidden",
      "For responsive elements, verify they exist at current viewport width"
    ];
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Elements presence check",
    progress: `Checked ${expected_elements.length} elements`,
    nextStep: missingCount > 0 ? "Add missing elements" : "Proceed to asset loading check"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}

function checkElementInSnapshot(snapshot, selector) {
  if (typeof snapshot === 'string') {
    const selectorPatterns = [
      selector,
      selector.replace('.', 'class="'),
      selector.replace('#', 'id="'),
      selector.replace(/\[([^\]]+)\]/, '$1')
    ];

    return selectorPatterns.some(pattern => snapshot.includes(pattern));
  }

  if (snapshot.elements && Array.isArray(snapshot.elements)) {
    return snapshot.elements.some(el =>
      el.selector === selector ||
      el.id === selector.replace('#', '') ||
      el.className?.includes(selector.replace('.', ''))
    );
  }

  if (snapshot.content) {
    return checkElementInSnapshot(snapshot.content, selector);
  }

  return JSON.stringify(snapshot).includes(selector);
}

export async function verifyAssetsLoaded(ctx, args) {
  const { chunker } = ctx;
  const {
    asset_checks,
    browser_asset_info
  } = args;

  if (!asset_checks || !Array.isArray(asset_checks)) {
    throw new Error('asset_checks must be an array of {selector, type, description}');
  }

  if (!browser_asset_info) {
    throw new Error('browser_asset_info is required - get it by evaluating asset status in browser via chrome-devtools.evaluate_script()');
  }

  const results = [];
  let loadedCount = 0;
  let brokenCount = 0;

  for (const asset of asset_checks) {
    const { selector, type = 'image', description } = asset;

    const assetInfo = browser_asset_info[selector];

    if (!assetInfo) {
      brokenCount++;
      results.push({
        selector,
        type,
        description,
        status: "not_found",
        issue: "Element not found in DOM"
      });
      continue;
    }

    if (type === 'image') {
      const status = evaluateImageStatus(assetInfo);
      results.push({
        selector,
        type,
        description,
        ...status
      });

      if (status.status === 'loaded') loadedCount++;
      else brokenCount++;
    } else if (type === 'background') {
      const status = evaluateBackgroundStatus(assetInfo);
      results.push({
        selector,
        type,
        description,
        ...status
      });

      if (status.status === 'loaded') loadedCount++;
      else brokenCount++;
    } else if (type === 'icon') {
      const status = evaluateIconStatus(assetInfo);
      results.push({
        selector,
        type,
        description,
        ...status
      });

      if (status.status === 'loaded') loadedCount++;
      else brokenCount++;
    }
  }

  const status = brokenCount > 0 ? "FAIL" : "PASS";

  const result = {
    status,
    total: asset_checks.length,
    loaded: loadedCount,
    broken: brokenCount,
    assets: results,
    summary: brokenCount > 0
      ? `${brokenCount} asset(s) failed to load properly`
      : `All ${loadedCount} assets loaded successfully`
  };

  if (brokenCount > 0) {
    result.fix_suggestions = [
      "Check file paths are correct (case-sensitive)",
      "Verify assets were extracted from Figma and saved",
      "Check for CORS issues if loading from external URLs",
      "Ensure image formats are supported by browser",
      "For SVG icons, verify SVG file is valid"
    ];
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: "Asset loading check",
    progress: `Checked ${asset_checks.length} assets`,
    nextStep: brokenCount > 0 ? "Fix broken assets" : "Proceed to visual comparison"
  }) : result;

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
  };
}

function evaluateImageStatus(info) {
  if (!info.complete) {
    return { status: 'loading', issue: 'Image still loading' };
  }

  if (info.naturalWidth === 0 || info.naturalHeight === 0) {
    return {
      status: 'broken',
      issue: 'Image failed to load (naturalWidth/Height is 0)',
      src: info.src
    };
  }

  if (info.naturalWidth === 1 && info.naturalHeight === 1) {
    return {
      status: 'placeholder',
      issue: '1x1 pixel detected - likely placeholder or tracking pixel',
      src: info.src
    };
  }

  if (info.naturalWidth < 10 || info.naturalHeight < 10) {
    return {
      status: 'suspicious',
      issue: `Very small image (${info.naturalWidth}x${info.naturalHeight}) - may be broken`,
      src: info.src
    };
  }

  return {
    status: 'loaded',
    dimensions: { width: info.naturalWidth, height: info.naturalHeight },
    src: info.src
  };
}

function evaluateBackgroundStatus(info) {
  if (!info.backgroundImage || info.backgroundImage === 'none') {
    return { status: 'missing', issue: 'No background-image set' };
  }

  const urlMatch = info.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
  if (!urlMatch) {
    return { status: 'invalid', issue: 'Invalid background-image format' };
  }

  const url = urlMatch[1];

  if (info.loaded === false) {
    return { status: 'broken', issue: 'Background image failed to load', src: url };
  }

  return { status: 'loaded', src: url };
}

function evaluateIconStatus(info) {
  if (info.tagName === 'svg' || info.tagName === 'SVG') {
    if (info.innerHTML && info.innerHTML.length > 10) {
      return { status: 'loaded', type: 'inline-svg' };
    }
    return { status: 'empty', issue: 'SVG element is empty' };
  }

  if (info.src && info.src.includes('.svg')) {
    if (info.naturalWidth > 0 && info.naturalHeight > 0) {
      return { status: 'loaded', type: 'svg-img', src: info.src };
    }
    return { status: 'broken', issue: 'SVG failed to load', src: info.src };
  }

  if (info.content && info.content !== 'none' && info.content !== '""') {
    return { status: 'loaded', type: 'font-icon' };
  }

  if (info.fontFamily && (
    info.fontFamily.includes('icon') ||
    info.fontFamily.includes('Font Awesome') ||
    info.fontFamily.includes('Material')
  )) {
    return { status: 'loaded', type: 'font-icon', font: info.fontFamily };
  }

  return { status: 'unknown', issue: 'Could not determine icon status' };
}
