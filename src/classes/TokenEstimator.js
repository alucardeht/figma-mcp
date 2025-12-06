class TokenEstimator {
  static LIMITS = {
    DEFAULT: 4000,
    HARD: 5000,
    SUMMARY: 500,
  };

  estimate(obj) {
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return Math.ceil(str.length / 4);
  }

  willExceed(obj, limit = TokenEstimator.LIMITS.DEFAULT) {
    return this.estimate(obj) > limit;
  }
}

export default TokenEstimator;
