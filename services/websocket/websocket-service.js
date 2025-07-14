const { WebSocketServer } = require("ws");
const { getId } = require("../../lib/common");
const { getCustomerAppName } = require("../../utils/app-name-helper");
const logger = require("../../utils/logger");
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

// Helper to parse REDIS_URL connection string
function parseRedisUrl(redisUrl) {
  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined
    };
  } catch (e) {
    return {};
  }
}

// Add cache clearing functionality for explore data
const exploreCache = new Map();

// Function to clear explore cache
function clearExploreCache() {
  exploreCache.clear();
  console.log('Explore cache cleared due to store status change');
}

// Function to clear specific location cache
function clearExploreCacheForLocation(location) {
  if (location) {
    const cacheKey = `explore_categories_${location.lat}_${location.lng}`;
    exploreCache.delete(cacheKey);
    console.log(`Explore cache cleared for location: ${cacheKey}`);
  } else {
    clearExploreCache();
  }
}

// Enhanced message handling for store updates
function handleStoreUpdate(message) {
  const { action, appName, storeData } = message;
  
  switch (action) {
    case 'store_updated':
      // Clear explore cache when store is updated
      clearExploreCache();
      
      // Notify all connected clients about the update
      broadcastToAllClients({
        type: 'store_status_changed',
        data: { appName, action }
      });
      break;
      
    case 'store_opened':
    case 'store_closed':
      // Clear cache for specific store location if available
      if (storeData && storeData.location) {
        clearExploreCacheForLocation(storeData.location);
      } else {
        clearExploreCache();
      }
      
      // Notify clients about store status change
      broadcastToAllClients({
        type: 'store_status_changed',
        data: { appName, action, storeData }
      });
      break;
      
    default:
      console.log('Unknown store action:', action);
  }
}

// Enhanced message processing
function processMessage(client, message) {
  try {
    const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
    
    // Handle store updates
    if (parsedMessage.type === 'store_update') {
      handleStoreUpdate(parsedMessage.data);
      return;
    }
    
    // Handle existing message types
    switch (parsedMessage.type) {
      case 'ping':
        handlePing(client);
        break;
      case 'subscribe':
        handleSubscribe(client, parsedMessage.data);
        break;
      case 'unsubscribe':
        handleUnsubscribe(client, parsedMessage.data);
        break;
      default:
        console.log('Unknown message type:', parsedMessage.type);
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

class WebSocketService {
  constructor() {
    this.clients = new Map(); // userId -> { connection, appName, appType, lastPing, metadata }
    this.rooms = new Map(); // roomId -> Set of userIds
    this.heartbeatInterval = 30000; // 30 seconds
    this.connectionTimeout = 60000; // 1 minute
    this.maxConnectionsPerUser = 3;
    this.redis = null;
    this.serverId = `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize WebSocket server with Redis
   */
  async init(server) {
    try {
      // Initialize Redis connection
      let redisOptions = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 10000, // 10s connection timeout
        commandTimeout: 5000,  // 5s command timeout
        keepAlive: 30000,      // 30s keep-alive for persistent connections
        enableOfflineQueue: false, // Better for real-time operations
        reconnectOnError: (err) => {
          // Handle READONLY errors (Redis failover scenarios)
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        }
      };
      if (process.env.REDIS_URL) {
        redisOptions = { ...redisOptions, ...parseRedisUrl(process.env.REDIS_URL) };
      }
      this.redis = new Redis(redisOptions);

      this.redis.on('error', (error) => {
        logger.error('Redis connection error:', error);
      });

      this.redis.on('connect', () => {
        console.log('✅ Redis connected for WebSocket service')
        logger.info('✅ Redis connected for WebSocket service');
      });

      this.redis.on('ready', () => {
        console.log('✅ Redis ready for WebSocket service');
        logger.info('✅ Redis ready for WebSocket service');
      });

      // Try to connect to Redis, but don't fail if it's not available
      try {
        await this.redis.connect();
        logger.info('Redis connected successfully');
      } catch (redisError) {
        logger.warn('Redis connection failed, running in local-only mode:', redisError.message);
        logger.warn('Cross-server communication and message queuing will be disabled');
        this.redis = null; // Set to null to indicate Redis is not available
      }

      this.wsServer = new WebSocketServer({ 
        server,
        clientTracking: false // We'll handle tracking ourselves
      });

      // this.wsServer.on("connection", this.handleConnection.bind(this));
      this.wsServer.on('connection', (ws, req) => {
        this.handleConnection.bind(this)(ws, req);
        ws.on('close', (code, reason) => {
          console.log(`WebSocket closed: code=${code}, reason=${reason}`);
        });
        ws.on('error', (err) => {
          console.log('WebSocket error:', err);
        });
      });
      // Start heartbeat
      this.startHeartbeat();
      
      // Start connection cleanup
      this.startConnectionCleanup();
      
      // Start Redis message listener only if Redis is available
      if (this.redis) {
        this.startRedisMessageListener();
      }
      
      logger.info(`WebSocket server initialized with ID: ${this.serverId}`);
    } catch (error) {
      logger.error('Failed to initialize WebSocket service:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(connection, req) {
    try {
      const connectionInfo = await this.authenticateConnection(req);
      if (!connectionInfo) {
        connection.close(1008, 'Authentication failed');
        return;
      }

      const { userId, appName, appType, metadata } = connectionInfo;
      
      // Check connection limits
      if (!await this.canConnect(userId)) {
        connection.close(1008, 'Too many connections');
        return;
      }

      // Store connection locally
      this.clients.set(userId, {
        connection,
        appName,
        appType,
        metadata,
        lastPing: Date.now(),
        connectedAt: Date.now(),
        serverId: this.serverId
      });

      // Store connection in Redis for cross-server communication (if available)
      if (this.redis) {
        try {
          await this.redis.hset(`ws:connections:${userId}`, {
            appName,
            appType,
            serverId: this.serverId,
            connectedAt: Date.now(),
            lastPing: Date.now()
          });

          // Set expiration for connection data
          await this.redis.expire(`ws:connections:${userId}`, 300); // 5 minutes
        } catch (redisError) {
          logger.warn(`Failed to store connection in Redis for ${userId}:`, redisError.message);
        }
      }

      // Join default room
      await this.joinRoom(userId, `${appType}`);

      // Set up connection event handlers
      this.setupConnectionHandlers(userId, connection);

      logger.info(`WebSocket connected: ${userId} (${appType}) on server ${this.serverId}`);
      
      // Send welcome message
      this.sendToUser(userId, {
        type: 'connection_established',
        data: { userId, appType, serverId: this.serverId }
      }, appType);

    } catch (error) {
      logger.error('Connection setup failed:', error);
      connection.close(1011, 'Internal server error');
    }
  }

  /**
   * Authenticate WebSocket connection
   */
  async authenticateConnection(req) {
    try {
      const url = new URL(req.url, 'ws://localhost');
      const token = url.searchParams.get('token');
      const customerId = url.searchParams.get('customerId');
      const appName = url.searchParams.get('appName');
      const appType = url.searchParams.get('appType');

      if (!token || !customerId || !appName || !appType) {
        logger.warn('Missing required parameters for WebSocket connection');
        return null;
      }

      // Verify JWT token
      // try {
      //   const decoded = jwt.verify(token, process.env.JWT_SECRET);
      //   if (decoded.customerId !== customerId) {
      //     logger.warn('Token customerId mismatch');
      //     return null;
      //   }
      // } catch (jwtError) {
      //   logger.warn('JWT verification failed:', jwtError.message);
      //   return null;
      // }

      return {
        userId: customerId,
        appName,
        appType,
        metadata: {
          userAgent: req.headers['user-agent'],
          ip: req.socket.remoteAddress
        }
      };

    } catch (error) {
      logger.error('Authentication failed:', error);
      return null;
    }
  }

  /**
   * Check if user can establish new connection
   */
  async canConnect(userId) {
    try {
      // Check local connections
      const localConnections = Array.from(this.clients.keys())
        .filter(key => key === userId).length;
      
      // Check Redis for connections on other servers (if available)
      if (this.redis) {
        try {
          const redisConnections = await this.redis.hgetall(`ws:connections:${userId}`);
          const totalConnections = localConnections + (redisConnections ? 1 : 0);
          return totalConnections < this.maxConnectionsPerUser;
        } catch (redisError) {
          logger.warn(`Failed to check Redis connections for ${userId}:`, redisError.message);
          // Fall back to local-only check
          return localConnections < this.maxConnectionsPerUser;
        }
      }
      
      // If Redis is not available, only check local connections
      return localConnections < this.maxConnectionsPerUser;
    } catch (error) {
      logger.error('Error checking connection limits:', error);
      return false;
    }
  }

  /**
   * Set up connection event handlers
   */
  setupConnectionHandlers(userId, connection) {
    connection.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(userId, message);
      } catch (error) {
        logger.error('Failed to parse WebSocket message:', error);
      }
    });

    connection.on('close', (code, reason) => {
      this.handleDisconnection(userId, code, reason);
    });

    connection.on('error', (error) => {
      logger.error(`WebSocket error for ${userId}:`, error);
      this.handleDisconnection(userId, 1011, 'Connection error');
    });

    connection.on('pong', () => {
      const client = this.clients.get(userId);
      if (client) {
        client.lastPing = Date.now();
        // Update Redis (if available)
        if (this.redis) {
          this.redis.hset(`ws:connections:${userId}`, 'lastPing', Date.now()).catch(err => {
            logger.error('Failed to update Redis ping time:', err);
          });
        }
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(userId, message) {
    const client = this.clients.get(userId);
    if (!client) return;

    logger.debug(`Received message from ${userId}:`, message);

    switch (message.type) {
      case 'ping':
        this.sendToUser(userId, { type: 'pong', data: { timestamp: Date.now() } }, client.appType);
        break;
      
      case 'join_room':
        if (message.room) {
          this.joinRoom(userId, message.room);
        }
        break;
      
      case 'leave_room':
        if (message.room) {
          this.leaveRoom(userId, message.room);
        }
        break;
      
      default:
        logger.debug(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  async handleDisconnection(userId, code, reason) {
    const client = this.clients.get(userId);
    if (!client) return;

    // Remove from all rooms
    this.rooms.forEach((users, roomId) => {
      users.delete(userId);
      if (users.size === 0) {
        this.rooms.delete(roomId);
      }
    });

    // Remove client locally
    this.clients.delete(userId);

    // Remove from Redis (if available)
    if (this.redis) {
      try {
        await this.redis.del(`ws:connections:${userId}`);
      } catch (error) {
        logger.error('Failed to remove connection from Redis:', error);
      }
    }

    logger.info(`WebSocket disconnected: ${userId} (code: ${code}, reason: ${reason})`);
  }

  /**
   * Send message to specific user
   */
  async sendToUser(userId, message, appType) {
    const client = this.clients.get(userId);
    
    // Check if user is connected to this server
    if (client && client.appType === appType) {
      try {
        const messageStr = JSON.stringify(message);
        console.log("WEBSOCKET_messageStr",messageStr)
        client.connection.send(messageStr);
        return { success: true, serverId: this.serverId };
      } catch (error) {
        logger.error(`Failed to send message to ${userId}:`, error);
        return { success: false, error: error.message, serverId: this.serverId };
      }
    }

    // Check if user is connected to another server (if Redis is available)
    if (this.redis) {
      try {
        const redisConnection = await this.redis.hgetall(`ws:connections:${userId}`);
        if (redisConnection && redisConnection.appType === appType) {
          // Publish message to Redis for other servers
          await this.redis.publish('websocket:message', JSON.stringify({
            userId,
            message,
            appType,
            targetServerId: redisConnection.serverId,
            sourceServerId: this.serverId
          }));
          return { success: true, serverId: redisConnection.serverId };
        }
      } catch (error) {
        logger.error('Failed to check Redis for user connection:', error);
      }
    }

    // User not found - queue message for later delivery (if Redis is available)
    if (this.redis) {
      await this.queueMessage(userId, message, appType);
    }
    return { success: false, error: 'User not connected', queued: this.redis ? true : false };
  }

  /**
   * Queue message for offline users
   */
  async queueMessage(userId, message, appType) {
    if (!this.redis) {
      logger.debug(`Cannot queue message for ${userId} - Redis not available`);
      return;
    }

    try {
      const messageData = {
        userId,
        message,
        appType,
        timestamp: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      };
      
      await this.redis.lpush(`ws:queue:${userId}`, JSON.stringify(messageData));
      await this.redis.expire(`ws:queue:${userId}`, 7 * 24 * 60 * 60); // 7 days
      
      logger.debug(`Message queued for user ${userId}`);
    } catch (error) {
      logger.error('Failed to queue message:', error);
    }
  }

  /**
   * Send queued messages to user when they connect
   */
  async sendQueuedMessages(userId) {
    if (!this.redis) {
      logger.debug(`Cannot send queued messages for ${userId} - Redis not available`);
      return;
    }

    try {
      const queuedMessages = await this.redis.lrange(`ws:queue:${userId}`, 0, -1);
      if (queuedMessages.length > 0) {
        for (const messageStr of queuedMessages) {
          const messageData = JSON.parse(messageStr);
          if (messageData.expiresAt > Date.now()) {
            await this.sendToUser(userId, messageData.message, messageData.appType);
          }
        }
        // Clear queue after sending
        await this.redis.del(`ws:queue:${userId}`);
        logger.info(`Sent ${queuedMessages.length} queued messages to ${userId}`);
      }
    } catch (error) {
      logger.error('Failed to send queued messages:', error);
    }
  }

  /**
   * Send message to multiple users
   */
  async sendToUsers(userIds, message, appType) {
    const results = [];
    for (const userId of userIds) {
      results.push(await this.sendToUser(userId, message, appType));
    }
    return results;
  }

  /**
   * Send message to room
   */
  async sendToRoom(roomId, message, appType) {
    const room = this.rooms.get(roomId);
    if (!room) {
      logger.warn(`Room ${roomId} not found`);
      return [];
    }

    const results = [];
    for (const userId of room) {
      const client = this.clients.get(userId);
      if (client && client.appType === appType) {
        results.push(await this.sendToUser(userId, message, appType));
      }
    }

    return results;
  }

  /**
   * Send message to all users in an app
   */
  async sendToApp(appType, message) {
    const results = [];
    for (const [userId, client] of this.clients) {
      if (client.appType === appType) {
        results.push(await this.sendToUser(userId, message, appType));
      }
    }
    return results;
  }

  /**
   * Send message to all admin users in an app
   */
  async sendToAppAdmins(appType, message, appName) {
    const results = [];
    for (const [userId, client] of this.clients) {
      if (client.appType === appType && client?.appName === appName) {
        results.push(await this.sendToUser(userId, message, appType));
      }
    }
    return results;
  }

  /**
   * Send message to all customers (non-admin users) in an app
   */
  async sendToAppCustomers(appType, message) {
    const results = [];
    for (const [userId, client] of this.clients) {
      // Send to customers (non-admin users) of the specific app
      if (client.appType === appType) {
        results.push(await this.sendToUser(userId, message, appType));
      }
    }
    return results;
  }

  /**
   * Join a room
   */
  async joinRoom(userId, roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(userId);
    logger.debug(`User ${userId} joined room ${roomId}`);
  }

  /**
   * Leave a room
   */
  leaveRoom(userId, roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
      logger.debug(`User ${userId} left room ${roomId}`);
    }
  }

  /**
   * Start Redis message listener for cross-server communication
   */
  startRedisMessageListener() {
    let subscriberOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    };
    if (process.env.REDIS_URL) {
      subscriberOptions = { ...subscriberOptions, ...parseRedisUrl(process.env.REDIS_URL) };
    }
    const subscriber = new Redis(subscriberOptions);

    subscriber.subscribe('websocket:message', (err) => {
      if (err) {
        logger.error('Failed to subscribe to Redis channel:', err);
      } else {
        logger.info('Subscribed to Redis websocket:message channel');
      }
    });

    subscriber.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        if (data.targetServerId === this.serverId) {
          const client = this.clients.get(data.userId);
          if (client && client.connection.readyState === client.connection.OPEN) {
            const messageStr = JSON.stringify(data.message);
            client.connection.send(messageStr);
          }
        }
      } catch (error) {
        logger.error('Failed to handle Redis message:', error);
      }
    });
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    setInterval(() => {
      this.clients.forEach((client, userId) => {
        if (client.connection.readyState === client.connection.OPEN) {
          try {
            client.connection.ping();
          } catch (error) {
            logger.error(`Failed to ping ${userId}:`, error);
            this.handleDisconnection(userId, 1011, 'Ping failed');
          }
        }
      });
    }, this.heartbeatInterval);
  }

  /**
   * Start connection cleanup
   */
  startConnectionCleanup() {
    setInterval(async () => {
      const now = Date.now();
      for (const [userId, client] of this.clients) {
        if (now - client.lastPing > this.connectionTimeout) {
          logger.warn(`Connection timeout for ${userId}`);
          this.handleDisconnection(userId, 1000, 'Connection timeout');
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * Get connection statistics
   */
  async getStats() {
    const stats = {
      totalConnections: this.clients.size,
      totalRooms: this.rooms.size,
      connectionsByApp: {},
      connectionsByType: {},
      serverId: this.serverId
    };

    this.clients.forEach((client, userId) => {
      // Count by app
      stats.connectionsByApp[client.appName] = (stats.connectionsByApp[client.appName] || 0) + 1;
      
      // Count by type
      stats.connectionsByType[client.appType] = (stats.connectionsByType[client.appType] || 0) + 1;
    });

    // Get Redis stats (if available)
    if (this.redis) {
      try {
        const redisConnections = await this.redis.keys('ws:connections:*');
        stats.totalRedisConnections = redisConnections.length;
        
        const queuedMessages = await this.redis.keys('ws:queue:*');
        stats.totalQueuedMessages = queuedMessages.length;

        // Get memory usage info
        const memoryInfo = await this.redis.info('memory');
        const usedMemory = memoryInfo.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';
        stats.redisMemoryUsage = usedMemory;

        // Get total keys count
        const totalKeys = await this.redis.dbsize();
        stats.totalRedisKeys = totalKeys;
      } catch (error) {
        logger.error('Failed to get Redis stats:', error);
        stats.redisError = error.message;
      }
    } else {
      stats.redisStatus = 'not_available';
      stats.totalRedisConnections = 0;
      stats.totalQueuedMessages = 0;
      stats.redisMemoryUsage = 'N/A';
      stats.totalRedisKeys = 0;
    }

    return stats;
  }

  /**
   * Broadcast message to all connected clients
   */
  async broadcast(message) {
    const results = [];
    for (const [userId, client] of this.clients) {
      try {
        const messageStr = JSON.stringify(message);
        client.connection.send(messageStr);
        results.push({ userId, success: true, serverId: this.serverId });
      } catch (error) {
        logger.error(`Failed to broadcast to ${userId}:`, error);
        results.push({ userId, success: false, error: error.message, serverId: this.serverId });
      }
    }
    return results;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    logger.info('Shutting down WebSocket service...');
    
    // Close all connections
    for (const [userId, client] of this.clients) {
      try {
        client.connection.close(1000, 'Server shutdown');
      } catch (error) {
        logger.error(`Error closing connection for ${userId}:`, error);
      }
    }
    
    // Close Redis connection
    if (this.redis) {
      await this.redis.quit();
    }
    
    logger.info('WebSocket service shutdown complete');
  }
}

// Create singleton instance
const websocketServiceInstance = new WebSocketService();

module.exports = websocketServiceInstance;

// Also export the class and utility functions for backward compatibility
module.exports.WebSocketService = WebSocketService;
module.exports.clearExploreCache = clearExploreCache;
module.exports.clearExploreCacheForLocation = clearExploreCacheForLocation;
module.exports.handleStoreUpdate = handleStoreUpdate;
module.exports.processMessage = processMessage; 