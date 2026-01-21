export function convertNodeIdToApiFormat(nodeId) {
  if (!nodeId) return null;
  return nodeId.replace(/-/g, ':');
}
