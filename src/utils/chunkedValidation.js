import sharp from 'sharp';

export const CHUNK_THRESHOLD = 4096;
export const DEFAULT_CHUNK_SIZE = 2048;
export const THUMBNAIL_SIZE = 512;
export const MAX_THUMBNAILS = 6;

export function needsChunking(width, height) {
  return width > CHUNK_THRESHOLD || height > CHUNK_THRESHOLD;
}

export function calculateChunkGrid(frameWidth, frameHeight, chunkSize = DEFAULT_CHUNK_SIZE) {
  const columns = Math.ceil(frameWidth / chunkSize);
  const rows = Math.ceil(frameHeight / chunkSize);
  const chunks = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = col * chunkSize;
      const y = row * chunkSize;
      const width = Math.min(chunkSize, frameWidth - x);
      const height = Math.min(chunkSize, frameHeight - y);

      chunks.push({
        id: `${col},${row}`,
        col,
        row,
        x,
        y,
        width,
        height,
        pixels: width * height
      });
    }
  }

  return { columns, rows, chunks };
}

export async function generateDiffThumbnail(diffImage) {
  const imageBuffer = typeof diffImage === 'string'
    ? Buffer.from(diffImage, 'base64')
    : diffImage;

  const metadata = await sharp(imageBuffer).metadata();

  const scale = Math.min(THUMBNAIL_SIZE / metadata.width, THUMBNAIL_SIZE / metadata.height);
  const newWidth = Math.round(metadata.width * scale);
  const newHeight = Math.round(metadata.height * scale);

  const thumbnail = await sharp(imageBuffer)
    .resize(newWidth, newHeight)
    .png({ quality: 80 })
    .toBuffer();

  return thumbnail.toString('base64');
}

export function consolidateChunkResults(chunkResults, passThreshold) {
  let totalPixels = 0;
  let weightedScore = 0;
  const failedChunks = [];

  for (const result of chunkResults) {
    weightedScore += result.matchScore * result.pixels;
    totalPixels += result.pixels;

    if (result.matchScore < passThreshold) {
      failedChunks.push(result);
    }
  }

  const overallScore = totalPixels > 0 ? weightedScore / totalPixels : 0;

  return {
    overallScore,
    passed: overallScore >= passThreshold,
    totalChunks: chunkResults.length,
    failedChunks: failedChunks.length,
    problemAreas: failedChunks
      .sort((a, b) => a.matchScore - b.matchScore)
      .slice(0, MAX_THUMBNAILS)
  };
}

export function generateGridMap(chunkResults, columns, rows, passThreshold) {
  const lines = [];
  const divider = '+' + '------+'.repeat(columns);

  lines.push(divider);

  for (let row = 0; row < rows; row++) {
    let rowLine = '|';
    for (let col = 0; col < columns; col++) {
      const chunk = chunkResults.find(c => c.col === col && c.row === row);
      const status = chunk && chunk.matchScore >= passThreshold ? ' PASS ' : ' FAIL ';
      rowLine += status + '|';
    }
    lines.push(rowLine);
    lines.push(divider);
  }

  return lines.join('\n');
}

export function generateChunkedRecommendations(problemAreas, columns, rows) {
  if (problemAreas.length === 0) {
    return ['Todos os chunks passaram na validação'];
  }

  const recs = [];

  const avgCol = problemAreas.reduce((sum, p) => sum + p.col, 0) / problemAreas.length;
  const avgRow = problemAreas.reduce((sum, p) => sum + p.row, 0) / problemAreas.length;

  let region = '';
  if (avgRow < rows / 3) region = 'superior';
  else if (avgRow > rows * 2 / 3) region = 'inferior';
  else region = 'central';

  if (avgCol < columns / 3) region = 'esquerda ' + region;
  else if (avgCol > columns * 2 / 3) region = 'direita ' + region;

  recs.push(`Foque na área ${region} - maior concentração de problemas`);

  const worst = problemAreas[0];
  recs.push(`Chunk ${worst.id} tem pior score (${worst.matchScore.toFixed(1)}%) - priorize este`);

  if (problemAreas.length > 3) {
    recs.push(`${problemAreas.length} chunks com problemas - considere revisar layout geral`);
  }

  return recs;
}

export async function extractFigmaChunk(imageUrl, chunk, cachedFullImage = null) {
  let fullImage = cachedFullImage;

  if (!fullImage) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(imageUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Figma API returned ${response.status}`);
        }
        fullImage = Buffer.from(await response.arrayBuffer());
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    clearTimeout(timeoutId);

    if (!fullImage) {
      throw new Error(`Failed to fetch Figma image after 3 attempts: ${lastError?.message}`);
    }
  }

  const chunkBuffer = await sharp(fullImage)
    .extract({
      left: chunk.x,
      top: chunk.y,
      width: chunk.width,
      height: chunk.height
    })
    .png()
    .toBuffer();

  return {
    buffer: chunkBuffer,
    fullImage
  };
}

export async function getImageDimensions(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  return {
    width: metadata.width,
    height: metadata.height
  };
}

export function validateImageSize(width, height) {
  const MAX_PIXELS = 32 * 1024 * 1024;
  const SAFE_PIXELS = 16 * 1024 * 1024;

  const pixels = width * height;

  if (pixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / pixels);
    return {
      safe: false,
      reason: 'exceeds_figma_limit',
      recommendedScale: Math.floor(scale * 100) / 100
    };
  }

  if (pixels > SAFE_PIXELS) {
    return {
      safe: true,
      reason: 'large_but_processable',
      warning: 'Imagem grande - será processada em chunks'
    };
  }

  return { safe: true };
}
