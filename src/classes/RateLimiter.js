class RateLimiter {
  constructor(tierLimits) {
    this.tierLimits = tierLimits || {
      1: { requests: 10, window: 60000 },
      2: { requests: 25, window: 60000 },
      3: { requests: 50, window: 60000 },
    };
    this.buckets = { 1: [], 2: [], 3: [] };
  }

  async waitForSlot(tier) {
    const limit = this.tierLimits[tier];
    const now = Date.now();

    this.buckets[tier] = this.buckets[tier].filter((t) => now - t < limit.window);

    if (this.buckets[tier].length >= limit.requests) {
      const oldestRequest = this.buckets[tier][0];
      const waitTime = limit.window - (now - oldestRequest) + 100;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.waitForSlot(tier);
    }

    this.buckets[tier].push(now);
    return true;
  }
}

export default RateLimiter;
