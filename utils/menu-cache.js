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
      // Parse Redis URL to extract connection options
      const redisUrl = process.env.REDIS_URL;
      
      // Configure Redis client with SSL support for DigitalOcean managed Redis
      this.redisClient = redis.createClient({
        url: redisUrl,
        socket: {
          tls: redisUrl.startsWith('rediss://'), // Enable TLS for rediss:// URLs
          rejectUnauthorized: false, // Allow self-signed certificates
          connectTimeout: 10000, // 10 seconds
          lazyConnect: true, // Don't connect immediately
        },
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            // End reconnecting on a specific error and flush all commands with a individual error
            console.error('Redis server refused connection');
            return new Error('Redis server refused connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            // End reconnecting after a specific timeout and flush all commands with a individual error
            console.error('Redis retry time exhausted');
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            // End reconnecting with built in error
            console.error('Redis max retry attempts reached');
            return undefined;
          }
          // Reconnect after
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.useRedis = false; // Fallback to memory cache
      });

      this.redisClient.on('connect', () => {
        console.log('✅ Redis connected for menu caching');
      });

      this.redisClient.on('ready', () => {
        console.log('✅ Redis ready for menu caching');
      });

      this.redisClient.on('end', () => {
        console.log('❌ Redis connection ended');
        this.useRedis = false;
      });

      await this.redisClient.connect();
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