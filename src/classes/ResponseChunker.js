import TokenEstimator from "./TokenEstimator.js";

class ResponseChunker {
  constructor(tokenEstimator, sessionManager) {
    this.tokenEstimator = tokenEstimator;
    this.session = sessionManager;
  }

  wrapResponse(data, options = {}) {
    const {
      step = "Operation completed",
      progress = "1/1",
      nextStep = null,
      canContinue = false,
      guidance = null,
      progressInfo = null,
    } = options;

    const response = {
      _navigation: {
        currentStep: step,
        progress,
        tokensThisResponse: 0,
        canContinue,
      },
      data,
    };

    if (nextStep) {
      response._navigation.nextStep = nextStep;
    }

    if (guidance) {
      response._guidance = guidance;
    }

    if (progressInfo) {
      response._progress = progressInfo;
    }

    response._navigation.tokensThisResponse = this.tokenEstimator.estimate(response);

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
