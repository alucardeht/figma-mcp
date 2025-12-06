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

export function buildAssetName(path) {
  const relevant = path.filter(
    (p) => !p.toLowerCase().startsWith("frame") && !p.toLowerCase().startsWith("group") && p.length > 1
  );
  return relevant.slice(-2).join("-");
}

export function findAssets(node, path) {
  if (!node) return [];

  const assets = [];
  const currentPath = [...path, node.name];

  const isIcon = isIconNode(node);
  const isImage = isImageNode(node);

  if (isIcon || isImage) {
    assets.push({
      id: node.id,
      name: buildAssetName(currentPath),
      category: isIcon ? "icon" : "image",
      type: node.type,
    });
  }

  if (node.children && !isIcon && !isImage) {
    node.children.forEach((child) => {
      assets.push(...findAssets(child, currentPath));
    });
  }

  return assets;
}
