import axios from "axios";
import RateLimiter from "../classes/RateLimiter.js";
import { convertNodeIdToApiFormat } from "../utils/nodeId.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";
const TIER_LIMITS = {
  1: { requests: 10, window: 60000 },
  2: { requests: 25, window: 60000 },
  3: { requests: 50, window: 60000 },
};

function filterInvisible(node) {
  if (!node) return null;

  if (node.visible === false) return null;

  if (!node.children) return node;

  const filteredChildren = node.children
    .filter(child => child.visible !== false)
    .map(child => filterInvisible(child))
    .filter(child => child !== null);

  return {
    ...node,
    children: filteredChildren
  };
}

class FigmaClient {
  constructor(token) {
    this.token = token;
    this.rateLimiter = new RateLimiter(TIER_LIMITS);
    this.cache = new Map();
  }

  async request(endpoint, params = {}, tier = 1) {
    await this.rateLimiter.waitForSlot(tier);

    const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await axios.get(`${FIGMA_API_BASE}${endpoint}`, {
        params,
        headers: { "X-Figma-Token": this.token },
      });
      this.cache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers["retry-after"] || "60", 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return this.request(endpoint, params, tier);
      }
      throw error;
    }
  }

  async getFile(fileKey, depth = 1) {
    const response = await this.request(`/files/${fileKey}`, { depth }, 1);
    if (response.document) {
      response.document = filterInvisible(response.document);
    }
    return response;
  }

  async getNode(fileKey, nodeId) {
    const data = await this.request(`/files/${fileKey}/nodes`, { ids: nodeId }, 1);
    const node = data.nodes[nodeId]?.document;
    return filterInvisible(node);
  }

  async getNodeById(fileKey, nodeId) {
    const apiNodeId = convertNodeIdToApiFormat(nodeId);
    return await this.getNode(fileKey, apiNodeId);
  }

  async getImage(fileKey, nodeIds, format = "png", scale = 2) {
    const ids = Array.isArray(nodeIds)
      ? nodeIds.map(convertNodeIdToApiFormat).join(",")
      : convertNodeIdToApiFormat(nodeIds);
    return await this.request(`/images/${fileKey}`, { ids, format, scale }, 1);
  }

  async getStyles(fileKey) {
    return await this.request(`/files/${fileKey}/styles`, {}, 2);
  }

  findPageByName(file, pageName) {
    const lowerName = pageName.toLowerCase();
    return file.document.children.find((p) => p.name.toLowerCase().includes(lowerName));
  }

  findFrameByName(page, frameName) {
    const lowerName = frameName.toLowerCase();

    const findInChildren = (children) => {
      for (const child of children) {
        if (
          (child.type === "FRAME" || child.type === "COMPONENT" || child.type === "COMPONENT_SET") &&
          child.name.toLowerCase().includes(lowerName)
        ) {
          return child;
        }
        if (child.children) {
          const found = findInChildren(child.children);
          if (found) return found;
        }
      }
      return null;
    };

    return findInChildren(page.children || []);
  }

  clearCache() {
    this.cache.clear();
  }
}

export default FigmaClient;
