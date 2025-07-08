#!/usr/bin/env node

const Redis = require('ioredis');
const colors = require('colors');

class RedisMonitor {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true
    });
  }

  async getStats() {
    try {
      console.log('\n🔍 Redis Monitoring Dashboard\n'.cyan.bold);
      console.log('='.repeat(50));

      // Basic Redis Info
      const info = await this.redis.info();
      const memoryInfo = await this.redis.info('memory');
      const statsInfo = await this.redis.info('stats');

      // Parse memory info
      const usedMemory = memoryInfo.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';
      const peakMemory = memoryInfo.match(/used_memory_peak_human:(\S+)/)?.[1] || 'unknown';
      const totalKeys = await this.redis.dbsize();

      console.log('\n�� Basic Redis Stats:'.yellow);
      console.log(`   Memory Used: ${usedMemory}`);
      console.log(`   Peak Memory: ${peakMemory}`);
      console.log(`   Total Keys: ${totalKeys}`);

      // WebSocket specific stats
      console.log('\n�� WebSocket Stats:'.yellow);
      
      const wsConnections = await this.redis.keys('ws:connections:*');
      const wsQueues = await this.redis.keys('ws:queue:*');
      
      console.log(`   Active Connections: ${wsConnections.length}`);
      console.log(`   Queued Messages: ${wsQueues.length}`);

      // Menu cache stats
      console.log('\n��️  Menu Cache Stats:'.yellow);
      const menuKeys = await this.redis.keys('menu:*');
      console.log(`   Cached Menus: ${menuKeys.length}`);

      // Connection details
      if (wsConnections.length > 0) {
        console.log('\n�� Active Connections Details:'.yellow);
        for (const key of wsConnections.slice(0, 5)) { // Show first 5
          const userId = key.replace('ws:connections:', '');
          const connectionData = await this.redis.hgetall(key);
          console.log(`   User: ${userId}`);
          console.log(`     App: ${connectionData.appName || 'N/A'}`);
          console.log(`     Type: ${connectionData.appType || 'N/A'}`);
          console.log(`     Server: ${connectionData.serverId || 'N/A'}`);
          console.log(`     Connected: ${new Date(parseInt(connectionData.connectedAt || 0)).toLocaleString()}`);
          console.log('');
        }
        
        if (wsConnections.length > 5) {
          console.log(`   ... and ${wsConnections.length - 5} more connections`);
        }
      }

      // Queued messages details
      if (wsQueues.length > 0) {
        console.log('\n📬 Queued Messages Details:'.yellow);
        for (const key of wsQueues.slice(0, 3)) { // Show first 3
          const userId = key.replace('ws:queue:', '');
          const queueLength = await this.redis.llen(key);
          console.log(`   User ${userId}: ${queueLength} messages`);
        }
        
        if (wsQueues.length > 3) {
          console.log(`   ... and ${wsQueues.length - 3} more users with queued messages`);
        }
      }

      // Menu cache details
      if (menuKeys.length > 0) {
        console.log('\n�� Menu Cache Details:'.yellow);
        for (const key of menuKeys.slice(0, 3)) { // Show first 3
          const storeId = key.replace('menu:', '');
          const ttl = await this.redis.ttl(key);
          console.log(`   Store ${storeId}: TTL ${ttl}s`);
        }
        
        if (menuKeys.length > 3) {
          console.log(`   ... and ${menuKeys.length - 3} more cached menus`);
        }
      }

      console.log('\n' + '='.repeat(50));
      console.log(`Last updated: ${new Date().toLocaleString()}\n`);

    } catch (error) {
      console.error('❌ Error getting Redis stats:', error.message);
    }
  }

  async startMonitoring(interval = 30000) { // 30 seconds default
    console.log(`🚀 Starting Redis monitoring (refresh every ${interval/1000}s)...\n`);
    
    // Initial stats
    await this.getStats();
    
    // Set up interval
    setInterval(async () => {
      console.clear(); // Clear console for better readability
      await this.getStats();
    }, interval);
  }

  async cleanup() {
    await this.redis.quit();
  }
}

// CLI usage
if (require.main === module) {
  const monitor = new RedisMonitor();
  
  const interval = process.argv[2] ? parseInt(process.argv[2]) * 1000 : 30000;
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down monitor...');
    await monitor.cleanup();
    process.exit(0);
  });

  monitor.startMonitoring(interval);
}

module.exports = RedisMonitor;