/**
 * Selective Server-Side Memory Cache Service
 * Provides fast sub-millisecond RAM retrieval for read-heavy public data and image BLOBs.
 * Strictly EXCLUDES sensitive authentication status and PII data.
 */

class MemoryCache {
  constructor(defaultTtlSeconds = 300, maxItems = 1000) {
    this.cache = new Map();
    this.defaultTtl = defaultTtlSeconds * 1000;
    this.maxItems = maxItems;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlSeconds = null) {
    if (this.cache.size >= this.maxItems) {
      // LRU Eviction: Remove oldest key
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    const ttl = (ttlSeconds ? ttlSeconds * 1000 : this.defaultTtl);
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  deletePattern(pattern) {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

const cacheService = new MemoryCache(300, 2000); // 5 min TTL, 2000 max items

module.exports = cacheService;
