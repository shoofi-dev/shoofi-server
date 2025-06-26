/**
 * Menu caching utilities
 * Supports both in-memory and Redis caching
 */

const redis = require('redis');

class MenuCache {
  constructor() {
    this.memoryCache = new Map();
    this.redisClient = null;
    this.useRedis = process.env.REDIS_URL || false;
    this.CACHE_TTL = 5 * 60; // 5 minutes in seconds
    
    if (this.useRedis) {
      this.initRedis();
    }
  }

  async initRedis() {
    try {
      this.redisClient = redis.createClient({
        url: process.env.REDIS_URL
      });

      this.redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.useRedis = false; // Fallback to memory cache
      });

      await this.redisClient.connect();
      console.log('✅ Redis connected for menu caching');
    } catch (error) {
      console.error('❌ Redis connection failed, using memory cache:', error);
      this.useRedis = false;
    }
  }

  async get(storeId) {
    try {
      if (this.useRedis && this.redisClient) {
        const cached = await this.redisClient.get(`menu:${storeId}`);
        return cached ? JSON.parse(cached) : null;
      } else {
        const cached = this.memoryCache.get(storeId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL * 1000) {
          return cached.data;
        }
        return null;
      }
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(storeId, data) {
    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.setEx(
          `menu:${storeId}`,
          this.CACHE_TTL,
          JSON.stringify(data)
        );
      } else {
        this.memoryCache.set(storeId, {
          data,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async clear() {
    try {
      if (this.useRedis && this.redisClient) {
        const keys = await this.redisClient.keys('menu:*');
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      } else {
        this.memoryCache.clear();
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  async clearStore(storeId) {
    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.del(`menu:${storeId}`);
      } else {
        this.memoryCache.delete(storeId);
      }
    } catch (error) {
      console.error('Cache clear store error:', error);
    }
  }

  async getStats() {
    try {
      if (this.useRedis && this.redisClient) {
        const keys = await this.redisClient.keys('menu:*');
        return {
          type: 'redis',
          cachedStores: keys.length,
          keys: keys
        };
      } else {
        return {
          type: 'memory',
          cachedStores: this.memoryCache.size,
          keys: Array.from(this.memoryCache.keys())
        };
      }
    } catch (error) {
      console.error('Cache stats error:', error);
      return { type: 'error', error: error.message };
    }
  }
}

// Singleton instance
const menuCache = new MenuCache();

module.exports = menuCache; 