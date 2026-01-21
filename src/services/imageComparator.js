import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

export async function compareImages(image1Buffer, image2Buffer, options = {}) {
  const {
    threshold = 0.1,
    includeAA = false,
    alpha = 0.1
  } = options;

  try {
    const [img1Data, img2Data] = await Promise.all([
      sharp(image1Buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
      sharp(image2Buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
    ]);

    const { width: w1, height: h1 } = img1Data.info;
    const { width: w2, height: h2 } = img2Data.info;

    if (w1 !== w2 || h1 !== h2) {
      return {
        success: false,
        error: "DIMENSION_MISMATCH",
        message: `Images have different dimensions: ${w1}x${h1} vs ${w2}x${h2}. Resize browser to match Figma viewport exactly.`,
        details: {
          figmaDimensions: { width: w1, height: h1 },
          browserDimensions: { width: w2, height: h2 }
        }
      };
    }

    const width = w1;
    const height = h1;
    const totalPixels = width * height;

    const diffBuffer = Buffer.alloc(width * height * 4);

    const mismatchedPixels = pixelmatch(
      img1Data.data,
      img2Data.data,
      diffBuffer,
      width,
      height,
      {
        threshold,
        includeAA,
        alpha
      }
    );

    const matchScore = ((totalPixels - mismatchedPixels) / totalPixels) * 100;
    const regions = analyzeProblematicRegions(diffBuffer, width, height);

    let diffImageBase64 = null;
    if (options.includeDiffImage !== false) {
      const diffPng = await sharp(diffBuffer, {
        raw: { width, height, channels: 4 }
      }).png().toBuffer();
      diffImageBase64 = diffPng.toString('base64');
    }

    return {
      success: true,
      matchScore: parseFloat(matchScore.toFixed(1)),
      mismatchedPixels,
      totalPixels,
      dimensions: { width, height },
      regions,
      threshold,
      diffImageBase64
    };
  } catch (error) {
    return {
      success: false,
      error: "COMPARISON_ERROR",
      message: error.message
    };
  }
}

function analyzeProblematicRegions(diffBuffer, width, height) {
  const gridCols = 3;
  const gridRows = 3;
  const cellWidth = Math.floor(width / gridCols);
  const cellHeight = Math.floor(height / gridRows);

  const regions = [];
  const regionNames = [
    ['top-left', 'top-center', 'top-right'],
    ['middle-left', 'center', 'middle-right'],
    ['bottom-left', 'bottom-center', 'bottom-right']
  ];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const startX = col * cellWidth;
      const startY = row * cellHeight;
      const endX = col === gridCols - 1 ? width : startX + cellWidth;
      const endY = row === gridRows - 1 ? height : startY + cellHeight;

      let mismatchCount = 0;
      const cellPixels = (endX - startX) * (endY - startY);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          if (diffBuffer[idx] > 0) {
            mismatchCount++;
          }
        }
      }

      const mismatchPercent = (mismatchCount / cellPixels) * 100;

      if (mismatchPercent > 5) {
        let severity = 'minor';
        if (mismatchPercent > 30) severity = 'critical';
        else if (mismatchPercent > 15) severity = 'moderate';

        regions.push({
          area: regionNames[row][col],
          bounds: { x: startX, y: startY, width: endX - startX, height: endY - startY },
          mismatchPercent: parseFloat(mismatchPercent.toFixed(1)),
          severity,
          possibleCause: inferPossibleCause(mismatchPercent, regionNames[row][col])
        });
      }
    }
  }

  const severityOrder = { critical: 0, moderate: 1, minor: 2 };
  regions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return regions;
}

function inferPossibleCause(mismatchPercent, region) {
  if (mismatchPercent > 50) {
    return "Major element missing or significantly different";
  } else if (mismatchPercent > 30) {
    return "Element missing, wrong position, or significantly wrong size";
  } else if (mismatchPercent > 15) {
    return "Color difference, font mismatch, or spacing issue";
  } else {
    return "Minor difference - possibly font rendering or anti-aliasing";
  }
}

export async function resizeImage(imageBuffer, width, height) {
  return sharp(imageBuffer)
    .resize(width, height, { fit: 'fill' })
    .toBuffer();
}

export async function getImageDimensions(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  return { width: metadata.width, height: metadata.height };
}
