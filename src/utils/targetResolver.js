import { convertNodeIdToApiFormat } from './nodeId.js';

const CONFIDENCE_GAP = 15;
const HIGH_CONFIDENCE = 85;
const MIN_SCORE_THRESHOLD = 30;

function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);

  const matrix = Array(b.length + 1).fill(null)
    .map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function shouldAutoReturn(candidates) {
  if (!candidates || candidates.length === 0) return { auto: false };
  if (candidates.length === 1) return { auto: true, reason: 'unique' };

  const [best, second] = candidates;

  if (best.score >= HIGH_CONFIDENCE) {
    return { auto: true, reason: 'high_confidence', score: best.score };
  }

  const gap = best.score - (second?.score || 0);
  if (gap >= CONFIDENCE_GAP) {
    return { auto: true, reason: 'clear_winner', gap };
  }

  return { auto: false, topScore: best.score, gap };
}

function calculateMatchScore(query, candidate) {
  if (!query || !candidate) return 0;

  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();

  if (q === c) return 100;

  if (c.includes(q)) return 85;

  if (q.includes(c)) return 60;

  const lenDiff = Math.abs(q.length - c.length);
  if (lenDiff <= 3) {
    const distance = levenshteinDistance(q, c);
    const maxLen = Math.max(q.length, c.length);
    const similarity = 1 - (distance / maxLen);

    if (maxLen <= 6) {
      if (distance <= 1) return Math.round(80 + (similarity * 15));
      if (distance <= 2) return Math.round(60 + (similarity * 20));
    }

    if (similarity >= 0.8) return Math.round(70 + (similarity * 20));
    if (similarity >= 0.6) return Math.round(50 + (similarity * 20));
    if (similarity >= 0.5) return Math.round(40 + (similarity * 15));
  }

  let score = 0;
  let qIdx = 0;

  for (let cIdx = 0; cIdx < c.length && qIdx < q.length; cIdx++) {
    if (c[cIdx] === q[qIdx]) {
      score += 10;
      qIdx++;
    }
  }

  if (qIdx === q.length) {
    return Math.min(score, 79);
  }

  const qWords = q.split(/[\s-_]/);
  const cWords = c.split(/[\s-_]/);
  let matchedWords = 0;

  const MIN_WORD_LENGTH = 3;
  const MIN_LENGTH_RATIO = 0.4;

  const qualifiedQueryWords = qWords.filter(w => w.length >= MIN_WORD_LENGTH);

  if (qualifiedQueryWords.length === 0) {
    return 0;
  }

  for (const qWord of qualifiedQueryWords) {
    const hasMatch = cWords.some((cWord) => {
      if (cWord.length < MIN_WORD_LENGTH) return false;
      if (cWord === qWord) return true;
      if (cWord.includes(qWord)) return true;
      if (qWord.includes(cWord)) {
        const ratio = cWord.length / qWord.length;
        return ratio >= MIN_LENGTH_RATIO;
      }

      if (Math.abs(cWord.length - qWord.length) <= 2) {
        const wordDist = levenshteinDistance(cWord, qWord);
        const wordSim = 1 - (wordDist / Math.max(cWord.length, qWord.length));
        if (wordSim >= 0.7) return true;
      }

      return false;
    });

    if (hasMatch) {
      matchedWords++;
    }
  }

  return (matchedWords / qualifiedQueryWords.length) * 50;
}

function formatSuggestions(candidates, limit = 5) {
  if (!candidates || candidates.length === 0) return [];

  return candidates
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit)
    .map((c) => `"${c.name}" (score: ${Math.round(c.score)})`);
}

function findNodeById(container, nodeId) {
  if (container.id === nodeId) return container;
  if (container.children) {
    for (const child of container.children) {
      const found = findNodeById(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

export function searchDeepElements(container, query, options = {}) {
  const {
    maxNodes = 5000,
    maxResults = 10,
    minScore = 30
  } = options;

  const results = [];
  let nodesSearched = 0;

  function traverse(node, path = [], parentPage = null) {
    if (nodesSearched >= maxNodes) return;
    nodesSearched++;

    const currentPath = [...path, node.name];
    const score = calculateMatchScore(query, node.name);

    if (score >= minScore) {
      results.push({
        type: 'element',
        name: node.name,
        id: node.id,
        nodeType: node.type,
        score,
        path: currentPath.join(' > '),
        pathArray: currentPath,
        depth: currentPath.length,
        bounds: node.absoluteBoundingBox ? {
          x: Math.round(node.absoluteBoundingBox.x),
          y: Math.round(node.absoluteBoundingBox.y),
          width: Math.round(node.absoluteBoundingBox.width),
          height: Math.round(node.absoluteBoundingBox.height)
        } : null,
        hasChildren: !!(node.children && node.children.length > 0),
        pageId: parentPage?.id,
        pageName: parentPage?.name
      });
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child, currentPath, parentPage);
      }
    }
  }

  if (container.type === 'PAGE' || container.type === 'CANVAS') {
    for (const child of container.children || []) {
      traverse(child, [container.name], container);
    }
  } else {
    traverse(container, []);
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

function countFrames(page) {
  if (!page || !page.children) return 0;
  return page.children.filter(
    (c) => c.type === "FRAME" || c.type === "COMPONENT"
  ).length;
}

export function resolveTarget(file, options = {}) {
  const { page_name, frame_name, query, element_name } = options;

  // Normalize node_id format (URL uses dashes "40000056-28165", API uses colons "40000056:28165")
  const node_id = options.node_id
    ? convertNodeIdToApiFormat(options.node_id)
    : null;

  if (!file) {
    return {
      success: false,
      error: "File object is required",
      errorType: "invalid_input",
    };
  }

  const pages = file.document?.children || [];

  if (node_id) {
    for (const page of pages) {
      const node = findNodeById(page, node_id);
      if (node) {
        return {
          success: true,
          type: "node",
          target: {
            id: node.id,
            name: node.name,
            type: node.type,
          },
          page: {
            id: page.id,
            name: page.name,
          },
          path: `${page.name} > ${node.name}`,
          matchScore: 100,
        };
      }
    }

    return {
      success: false,
      error: `Node with ID "${node_id}" not found in any page`,
      errorType: "not_found",
    };
  }

  if (element_name) {
    const containerResolution = resolveTarget(file, {
      node_id,
      page_name,
      frame_name,
      query
    });

    if (!containerResolution.success) {
      return containerResolution;
    }

    const page = file.document.children.find(
      p => p.id === (containerResolution.page?.id || containerResolution.target.id)
    );

    if (!page) {
      return {
        success: false,
        error: 'Could not find page for element search',
        errorType: 'not_found'
      };
    }

    let container = page;
    if (containerResolution.type === 'frame' || containerResolution.type === 'node') {
      container = findNodeById(page, containerResolution.target.id);
    }

    if (!container) {
      return {
        success: false,
        error: 'Could not find container for element search',
        errorType: 'not_found'
      };
    }

    const elements = searchDeepElements(container, element_name);

    if (elements.length === 0) {
      return {
        success: false,
        error: `Element "${element_name}" not found in ${containerResolution.path || container.name}`,
        errorType: 'not_found',
        searchedIn: containerResolution.path || container.name,
        suggestion: 'Check element name spelling or try a partial match'
      };
    }

    if (elements.length === 1 || elements[0].score > 90) {
      const element = elements[0];
      return {
        success: true,
        type: 'element',
        target: {
          id: element.id,
          name: element.name,
          type: element.nodeType,
          bounds: element.bounds,
          hasChildren: element.hasChildren
        },
        page: containerResolution.page || {
          id: page.id,
          name: page.name
        },
        container: {
          id: container.id,
          name: container.name
        },
        path: element.path,
        matchScore: element.score
      };
    }

    return {
      success: false,
      error: `Multiple elements match "${element_name}"`,
      errorType: 'ambiguous',
      candidates: elements.slice(0, 5).map(e => ({
        name: e.name,
        path: e.path,
        id: e.id,
        score: e.score
      })),
      suggestion: 'Use a more specific name or provide the node_id directly'
    };
  }

  if (page_name) {
    const pageCandidates = pages
      .map((p) => ({
        ...p,
        score: calculateMatchScore(page_name, p.name),
      }))
      .filter((p) => p.score >= 30)
      .sort((a, b) => b.score - a.score);

    if (pageCandidates.length === 0) {
      return {
        success: false,
        error: `Page "${page_name}" not found`,
        errorType: "not_found",
        suggestions: pages.slice(0, 5).map((p) => `"${p.name}"`),
        candidates: pages.map((p) => ({
          name: p.name,
          id: p.id,
          score: calculateMatchScore(page_name, p.name),
        })),
      };
    }

    const matchedPage = pageCandidates[0];

    if (frame_name) {
      const frames = (matchedPage.children || []).filter(
        (c) => c.type === "FRAME" || c.type === "COMPONENT"
      );
      const frameCandidates = frames
        .map((f) => ({
          ...f,
          score: calculateMatchScore(frame_name, f.name),
        }))
        .filter((f) => f.score >= 30)
        .sort((a, b) => b.score - a.score);

      if (frameCandidates.length === 0) {
        const deepMatches = searchDeepElements(matchedPage, frame_name, {
          maxResults: 3,
          minScore: 50
        });

        if (deepMatches.length > 0) {
          const bestMatch = deepMatches[0];
          const framePath = bestMatch.path.split(' > ')[0];

          return {
            success: false,
            error: `Frame "${frame_name}" not found, but element "${bestMatch.name}" exists as ${bestMatch.nodeType}`,
            errorType: "wrong_target_type",
            foundAs: {
              name: bestMatch.name,
              path: bestMatch.path,
              id: bestMatch.id,
              type: bestMatch.nodeType,
              score: bestMatch.score
            },
            hint: `"${frame_name}" is not a top-level frame. It exists inside the page structure. Use one of these approaches:\n• element_name="${bestMatch.name}" - to get this specific element\n• node_id="${bestMatch.id}" - direct access by ID\n• Check if it's nested inside another frame: "${framePath}"`,
            suggestions: frames.slice(0, 5).map((f) => ({
              name: f.name,
              id: f.id,
              score: calculateMatchScore(frame_name, f.name)
            })),
            deepSearchResults: deepMatches.slice(0, 3).map(m => ({
              name: m.name,
              path: m.path,
              id: m.id,
              type: m.nodeType,
              score: m.score
            }))
          };
        }

        return {
          success: false,
          error: `Frame "${frame_name}" not found in page "${matchedPage.name}"`,
          errorType: "not_found",
          hint: `If "${frame_name}" is a nested element (not a top-level frame), try: element_name="${frame_name}" instead of frame_name. Or explore the page structure first with figma_get to find the correct path.`,
          suggestions: frames.slice(0, 5).map((f) => `"${f.name}"`),
          candidates: frames.map((f) => ({
            name: f.name,
            id: f.id,
            score: calculateMatchScore(frame_name, f.name),
          })),
        };
      }

      const matchedFrame = frameCandidates[0];
      return {
        success: true,
        type: "frame",
        target: {
          id: matchedFrame.id,
          name: matchedFrame.name,
          type: matchedFrame.type,
        },
        page: {
          id: matchedPage.id,
          name: matchedPage.name,
        },
        path: `${matchedPage.name} > ${matchedFrame.name}`,
        matchScore: Math.round(matchedFrame.score),
      };
    }

    if (frame_name) {
      return {
        success: false,
        error: `Frame "${frame_name}" not found in page "${matchedPage.name}"`,
        errorType: "not_found",
        searchedIn: matchedPage.name,
        suggestions: (matchedPage.children || [])
          .filter((c) => c.type === "FRAME" || c.type === "COMPONENT")
          .slice(0, 5)
          .map((f) => ({
            name: f.name,
            id: f.id,
            score: calculateMatchScore(frame_name, f.name),
          })),
      };
    }

    return {
      success: true,
      type: "page",
      target: {
        id: matchedPage.id,
        name: matchedPage.name,
        type: "PAGE",
      },
      path: matchedPage.name,
      frameCount: countFrames(matchedPage),
      matchScore: Math.round(matchedPage.score),
    };
  }

  if (query) {
    const allCandidates = [];

    for (const page of pages) {
      const pageScore = calculateMatchScore(query, page.name);
      if (pageScore >= 30) {
        allCandidates.push({
          type: "page",
          name: page.name,
          id: page.id,
          pageId: page.id,
          score: pageScore,
          path: page.name,
        });
      }

      const frames = (page.children || []).filter(
        (c) => c.type === "FRAME" || c.type === "COMPONENT"
      );
      for (const frame of frames) {
        const frameScore = calculateMatchScore(query, frame.name);
        if (frameScore >= 30) {
          allCandidates.push({
            type: "frame",
            name: frame.name,
            id: frame.id,
            pageId: page.id,
            pageName: page.name,
            score: frameScore,
            path: `${page.name} > ${frame.name}`,
          });
        }
      }
    }

    if (allCandidates.length === 0) {
      return {
        success: false,
        error: `No results found for query "${query}"`,
        errorType: "not_found",
        suggestions: [],
        candidates: [],
      };
    }

    allCandidates.sort((a, b) => b.score - a.score);

    const autoResult = shouldAutoReturn(allCandidates);
    if (autoResult.auto) {
      const result = allCandidates[0];
      return {
        success: true,
        type: result.type,
        target: {
          id: result.id,
          name: result.name,
          type: result.type === "page" ? "PAGE" : "FRAME",
        },
        page:
          result.type === "frame"
            ? { id: result.pageId, name: result.pageName }
            : undefined,
        path: result.path,
        matchScore: Math.round(result.score),
        _autoReturn: autoResult.reason,
        _alternatives: allCandidates.length > 1 ? allCandidates.slice(1, 4).map(c => ({
          name: c.name,
          score: Math.round(c.score)
        })) : undefined
      };
    }

    return {
      success: false,
      error: `Multiple close matches for "${query}"`,
      errorType: "ambiguous",
      hint: `Top matches have similar scores. Specify more precisely or use node_id.`,
      bestMatch: {
        name: allCandidates[0].name,
        id: allCandidates[0].id,
        score: Math.round(allCandidates[0].score),
        path: allCandidates[0].path
      },
      suggestions: formatSuggestions(allCandidates, 5),
      candidates: allCandidates.slice(0, 10).map((c) => ({
        name: c.name,
        type: c.type,
        id: c.id,
        path: c.path,
        score: Math.round(c.score),
      })),
    };
  }

  return {
    success: false,
    error: "At least one of: node_id, page_name, or query is required",
    errorType: "invalid_input",
  };
}

export { calculateMatchScore, formatSuggestions, countFrames, shouldAutoReturn, levenshteinDistance };
