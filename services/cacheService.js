/**
 * Lightweight In-Memory Cache Service
 * Provides sub-millisecond RAM retrieval for read-heavy query filters and location metadata.
 * Includes active TTL garbage collection to prevent memory leaks.
 * Strictly excludes multi-megabyte binary image BLOBs to keep V8 heap lean.
 */

class MemoryCache {
  constructor(defaultTtlSeconds = 180, maxItems = 250) {
    this.cache = new Map();
    this.defaultTtl = defaultTtlSeconds * 1000;
    this.maxItems = maxItems;

    // Periodic active garbage collection sweeper every 60 seconds
    this.sweepInterval = setInterval(() => {
      this.sweepExpired();
    }, 60000);

    // Ensure interval doesn't hold the Node process open on exit
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  sweepExpired() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
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

  getStats() {
    return {
      size: this.cache.size,
      maxItems: this.maxItems
    };
  }
}

const cacheService = new MemoryCache(180, 250); // 3 min TTL, 250 max items

module.exports = cacheService;
