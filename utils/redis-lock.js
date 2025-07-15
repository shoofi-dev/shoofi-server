const Redis = require('ioredis');

// Helper to parse REDIS_URL connection string (same as in websocket-service)
function parseRedisUrl(redisUrl) {
  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: url.port,
      password: url.password,
      tls: url.protocol === 'rediss:' ? {} : undefined
    };
  } catch (error) {
    console.error('Invalid REDIS_URL:', error);
    return {};
  }
}

// Initialize Redis connection
let redis = null;

function getRedisClient() {
  if (redis) {
    return redis;
  }

  let redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  };

  // Handle READONLY errors (Redis failover scenarios)
  redisOptions.retryDelayOnFailover = 100;
  redisOptions.maxRetriesPerRequest = 3;

  if (process.env.REDIS_URL) {
    redisOptions = { ...redisOptions, ...parseRedisUrl(process.env.REDIS_URL) };
  }

  redis = new Redis(redisOptions);

  redis.on('error', (error) => {
    console.error('Redis lock connection error:', error);
  });

  redis.on('connect', () => {
    console.log('✅ Redis connected for distributed locks');
  });

  redis.on('ready', () => {
    console.log('✅ Redis ready for distributed locks');
  });

  return redis;
}

/**
 * Try to acquire a distributed lock
 * @param {string} key - The lock key
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {Promise<boolean>} - True if lock was acquired, false otherwise
 */
async function acquireLock(key, ttlMs) {
  try {
    const redisClient = getRedisClient();
    const result = await redisClient.set(key, 'locked', 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch (error) {
    console.error(`Failed to acquire lock for key ${key}:`, error);
    return false;
  }
}

/**
 * Release a distributed lock
 * @param {string} key - The lock key
 * @returns {Promise<void>}
 */
async function releaseLock(key) {
  try {
    const redisClient = getRedisClient();
    await redisClient.del(key);
  } catch (error) {
    console.error(`Failed to release lock for key ${key}:`, error);
  }
}

/**
 * Check if a lock exists
 * @param {string} key - The lock key
 * @returns {Promise<boolean>} - True if lock exists, false otherwise
 */
async function isLocked(key) {
  try {
    const redisClient = getRedisClient();
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`Failed to check lock for key ${key}:`, error);
    return false;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  isLocked,
  getRedisClient
}; 