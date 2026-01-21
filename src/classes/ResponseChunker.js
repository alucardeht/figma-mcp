import TokenEstimator from "./TokenEstimator.js";

class ResponseChunker {
  constructor(tokenEstimator, sessionManager) {
    this.tokenEstimator = tokenEstimator;
    this.session = sessionManager;
  }

  wrapResponse(data, options = {}) {
    const {
      progress = null,
      canContinue = false,
    } = options;

    const response = { data };

    if (progress || canContinue) {
      response._navigation = {};
      if (progress) response._navigation.progress = progress;
      if (canContinue) response._navigation.canContinue = true;
    }

    this.session.storeLastResponse(response);

    return response;
  }

  chunkArray(array, operationId, maxItemsPerChunk = 20) {
    if (array.length <= maxItemsPerChunk) {
      return null;
    }

    const chunks = [];
    for (let i = 0; i < array.length; i += maxItemsPerChunk) {
      chunks.push(array.slice(i, i + maxItemsPerChunk));
    }

    this.session.storePendingChunks(operationId, chunks);

    return {
      items: chunks[0],
      chunkIndex: 1,
      totalChunks: chunks.length,
      totalItems: array.length,
    };
  }
}

export default ResponseChunker;
