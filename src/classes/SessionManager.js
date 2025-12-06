class SessionManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.currentFile = null;
    this.exploredPages = new Set();
    this.exploredFrames = new Set();
    this.pendingChunks = new Map();
    this.lastResponse = null;
    this.lastUpdated = Date.now();
  }

  setCurrentFile(fileKey) {
    if (this.currentFile !== fileKey) {
      this.currentFile = fileKey;
      this.exploredPages.clear();
      this.exploredFrames.clear();
      this.pendingChunks.clear();
    }
    this.lastUpdated = Date.now();
  }

  markPageExplored(pageId) {
    this.exploredPages.add(pageId);
    this.lastUpdated = Date.now();
  }

  markFrameExplored(frameId) {
    this.exploredFrames.add(frameId);
    this.lastUpdated = Date.now();
  }

  storePendingChunks(operationId, chunks) {
    this.pendingChunks.set(operationId, {
      chunks,
      currentIndex: 1,
      totalChunks: chunks.length,
    });
    this.lastUpdated = Date.now();
  }

  getNextChunk(operationId) {
    const pending = this.pendingChunks.get(operationId);
    if (!pending || pending.currentIndex >= pending.totalChunks) {
      return null;
    }
    const chunkData = pending.chunks[pending.currentIndex];
    const currentChunkIndex = pending.currentIndex + 1;
    pending.currentIndex++;
    if (pending.currentIndex >= pending.totalChunks) {
      this.pendingChunks.delete(operationId);
    }
    this.lastUpdated = Date.now();
    return {
      items: chunkData,
      chunkIndex: currentChunkIndex,
      totalChunks: pending.totalChunks,
      totalItems: pending.chunks.reduce((sum, c) => sum + c.length, 0),
    };
  }

  hasPendingChunks(operationId) {
    const pending = this.pendingChunks.get(operationId);
    return pending && pending.currentIndex < pending.totalChunks;
  }

  storeLastResponse(response) {
    this.lastResponse = response;
    this.lastUpdated = Date.now();
  }

  getLastResponse() {
    return this.lastResponse;
  }

  getState() {
    return {
      currentFile: this.currentFile,
      exploredPages: Array.from(this.exploredPages),
      exploredFrames: Array.from(this.exploredFrames),
      pendingOperations: Array.from(this.pendingChunks.keys()),
      hasLastResponse: this.lastResponse !== null,
      lastUpdated: new Date(this.lastUpdated).toISOString(),
    };
  }
}

export default SessionManager;
