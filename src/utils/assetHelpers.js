export function isIconNode(node) {
  const name = node.name.toLowerCase();
  const hasIconKeyword =
    name.includes("icon") ||
    name.includes("ico") ||
    name.includes("logo") ||
    name.includes("symbol") ||
    name.includes("arrow") ||
    name.includes("chevron");
  const isVectorType = node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION";
  const isSmall =
    node.absoluteBoundingBox &&
    node.absoluteBoundingBox.width <= 64 &&
    node.absoluteBoundingBox.height <= 64;

  return hasIconKeyword || (isVectorType && isSmall);
}

export function isImageNode(node) {
  const hasImageFill = node.fills?.some((f) => f.type === "IMAGE");
  const name = node.name.toLowerCase();
  const hasImageKeyword =
    name.includes("image") ||
    name.includes("photo") ||
    name.includes("img") ||
    name.includes("picture") ||
    name.includes("banner") ||
    name.includes("hero") ||
    name.includes("background") ||
    name.includes("bg");

  return hasImageFill || (node.type === "RECTANGLE" && hasImageKeyword);
}

const SECTION_KEYWORDS = [
  "hero",
  "about",
  "features",
  "footer",
  "contact",
  "header",
  "nav",
  "navbar",
  "menu",
  "cta",
  "testimonial",
  "pricing",
  "faq",
];

export function buildAssetPath(node) {
  const path = [];
  let current = node;

  while (current) {
    path.unshift(current.name);
    current = current.parent;
  }

  return path;
}

export function getSectionFromPath(path) {
  for (const segment of path) {
    const lower = segment.toLowerCase();
    for (const keyword of SECTION_KEYWORDS) {
      if (lower.includes(keyword)) {
        return keyword;
      }
    }
  }
  return null;
}

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isGenericName(name) {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("frame") ||
    lower.startsWith("group") ||
    lower.startsWith("component") ||
    lower === "page" ||
    lower === "artboard" ||
    name.length <= 1
  );
}

function filterPathSegments(path) {
  return path.filter(
    (segment) =>
      !isGenericName(segment) &&
      segment.length > 0
  );
}

export function buildAssetName(path, options = {}) {
  const { sectionName, parentName, index, bounds } = options;
  const nameParts = [];

  if (sectionName) {
    nameParts.push(sanitizeName(sectionName));
  }

  if (parentName) {
    nameParts.push(sanitizeName(parentName));
  }

  const relevantPath = filterPathSegments(path);
  const assetName = relevantPath[relevantPath.length - 1];

  if (assetName) {
    nameParts.push(sanitizeName(assetName));
  }

  let finalName = nameParts.join("-").replace(/-+/g, "-");

  if (index && index > 0) {
    finalName += `-${index}`;
  }

  return finalName || "asset";
}

export function findAssets(node, options = {}) {
  if (!node) return [];

  const assets = [];
  const {
    path = [],
    sectionId = null,
    depth = 0,
    nameCountMap = new Map()
  } = options;

  const currentPath = [...path, node.name];

  const isIcon = isIconNode(node);
  const isImage = isImageNode(node);

  if (isIcon || isImage) {
    const section = getSectionFromPath(currentPath);
    const parentName = currentPath.length > 1 ? currentPath[currentPath.length - 2] : null;

    const assetPath = filterPathSegments(currentPath);
    let uniqueName = buildAssetName(assetPath, {
      sectionName: section,
      parentName,
    });

    const countKey = uniqueName;
    const count = (nameCountMap.get(countKey) || 0) + 1;
    nameCountMap.set(countKey, count);

    if (count > 1) {
      uniqueName = buildAssetName(assetPath, {
        sectionName: section,
        parentName,
        index: count - 1,
      });
    }

    assets.push({
      id: node.id,
      name: uniqueName,
      originalName: node.name,
      category: isIcon ? "icon" : "image",
      type: node.type,
      bounds: node.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 },
      path: currentPath,
      sectionId: sectionId,
      parentName: parentName ? sanitizeName(parentName) : null,
      depth: currentPath.length - 1,
    });
  }

  if (node.children && !isIcon && !isImage) {
    node.children.forEach((child) => {
      assets.push(
        ...findAssets(child, {
          path: currentPath,
          sectionId,
          depth: depth + 1,
          nameCountMap,
        })
      );
    });
  }

  return assets;
}
