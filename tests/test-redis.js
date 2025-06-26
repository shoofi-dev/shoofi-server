/**
 * Test Redis connection
 * Run with: node test-redis.js
 */

require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
const redis = require('redis');

async function testRedisConnection() {
  console.log('🔍 Testing Redis connection...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('REDIS_URL:', process.env.REDIS_URL ? 'Set (hidden for security)' : 'Not set');
  
  if (!process.env.REDIS_URL) {
    console.error('❌ REDIS_URL not found in environment variables');
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  
  try {
    // Create Redis client with SSL support
    const client = redis.createClient({
      url: redisUrl,
      socket: {
        tls: redisUrl.startsWith('rediss://'),
        rejectUnauthorized: false,
        connectTimeout: 10000,
        lazyConnect: true,
      }
    });

    client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('✅ Redis connected');
    });

    client.on('ready', () => {
      console.log('✅ Redis ready');
    });

    client.on('end', () => {
      console.log('❌ Redis connection ended');
    });

    // Connect to Redis
    await client.connect();
    
    // Test basic operations
    console.log('🧪 Testing Redis operations...');
    
    // Set a test key
    await client.set('test:connection', 'Hello Redis!', 'EX', 60);
    console.log('✅ Set test key');
    
    // Get the test key
    const value = await client.get('test:connection');
    console.log('✅ Get test key:', value);
    
    // Delete the test key
    await client.del('test:connection');
    console.log('✅ Delete test key');
    
    // Test ping
    const ping = await client.ping();
    console.log('✅ Ping response:', ping);
    
    await client.quit();
    console.log('✅ Redis test completed successfully');
    
  } catch (error) {
    console.error('❌ Redis test failed:', error);
  }
}

