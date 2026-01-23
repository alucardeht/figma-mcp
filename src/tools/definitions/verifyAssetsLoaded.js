import { z } from 'zod';

export const name = 'verify_assets_loaded';

export const description = `Verify image/icon assets loaded correctly (not 404/broken). Detects broken images, placeholders, failed backgrounds, missing SVG. Returns status, counts, per-asset details.`;

const assetCheckObject = z.object({
  selector: z.string().describe('CSS selector for the asset element'),
  type: z.enum(['image', 'background', 'icon']).default('image'),
  description: z.string().optional().describe('Human-readable description')
});

export const inputSchema = {
  asset_checks: z.array(assetCheckObject).describe('Array of assets to verify'),
  browser_asset_info: z.record(z.string(), z.any()).describe('Map of selector → asset info from browser. Get via chrome-devtools.evaluate_script()')
};

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

export async function handler(args, ctx) {
  const { chunker } = ctx;
  const {
    asset_checks,
    browser_asset_info
  } = args;

  const results = [];
  let loadedCount = 0;
  let brokenCount = 0;

  for (const asset of asset_checks) {
    const { selector, type, description } = asset;

    const assetInfo = browser_asset_info[selector];

    if (!assetInfo) {
      brokenCount++;
      results.push({
        selector,
        type,
        description,
        status: 'not_found',
        issue: 'Element not found in DOM'
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

  const status = brokenCount > 0 ? 'FAIL' : 'PASS';

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
      'Check file paths are correct (case-sensitive)',
      'Verify assets were extracted from Figma and saved',
      'Check for CORS issues if loading from external URLs',
      'Ensure image formats are supported by browser',
      'For SVG icons, verify SVG file is valid'
    ];
  }

  const response = chunker ? chunker.wrapResponse(result, {
    step: 'Asset loading check',
    progress: `Checked ${asset_checks.length} assets`,
    nextStep: brokenCount > 0 ? 'Fix broken assets' : 'Proceed to visual comparison'
  }) : result;

  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
  };
}
