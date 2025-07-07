const { WebSocketServer } = require("ws");
const { getId } = require("../../lib/common");
const { getCustomerAppName } = require("../../utils/app-name-helper");
const logger = require("../../utils/logger");
const jwt = require('jsonwebtoken');

class WebSocketService {
  constructor() {
    this.clients = new Map(); // userId -> { connection, appName, lastPing, metadata }
    this.rooms = new Map(); // roomId -> Set of userIds
    this.heartbeatInterval = 30000; // 30 seconds
    this.connectionTimeout = 60000; // 1 minute
    this.maxConnectionsPerUser = 3;
  }

  /**
   * Initialize WebSocket server
   */
  init(server) {
    this.wsServer = new WebSocketServer({ 
      server,
      clientTracking: false // We'll handle tracking ourselves
    });

    this.wsServer.on("connection", this.handleConnection.bind(this));
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start connection cleanup
    this.startConnectionCleanup();
    
    logger.info('WebSocket server initialized');
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
      if (!this.canConnect(userId)) {
        connection.close(1008, 'Too many connections');
        return;
      }

      // Store connection
      this.clients.set(userId, {
        connection,
        appName,
        appType,
        metadata,
        lastPing: Date.now(),
        connectedAt: Date.now()
      });

      // Join default room
      this.joinRoom(userId, `${appType}`);
      // if (userType === 'admin') {
      //   this.joinRoom(userId, `admin:${appName}`);
      // }

      // Set up connection event handlers
      this.setupConnectionHandlers(userId, connection);

      logger.info(`WebSocket connected: ${userId} (${appType})`);
      
      // Send welcome message
      this.sendToUser(userId, {
        type: 'connection_established',
        data: { userId, appType }
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
      // const userType = url.searchParams.get('userType');

      // if (!token || !customerId || !appName) {
      //   logger.warn('Missing required parameters for WebSocket connection');
      //   return null;
      // }

      // Verify JWT token (you should implement proper JWT verification)
      // const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // For now, we'll use a simple validation
      // const userType = customerId.includes('__admin') ? 'admin' : 'user';
      // const cleanUserId = customerId.replace('__admin', '');  

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
  canConnect(userId) {
    const existingConnections = Array.from(this.clients.keys())
      .filter(key => key === userId).length;
    
    return existingConnections < this.maxConnectionsPerUser;
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
        this.sendToUser(userId, { type: 'pong', data: { timestamp: Date.now() } }, client.appName);
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
  handleDisconnection(userId, code, reason) {
    const client = this.clients.get(userId);
    if (!client) return;

    // Remove from all rooms
    this.rooms.forEach((users, roomId) => {
      users.delete(userId);
      if (users.size === 0) {
        this.rooms.delete(roomId);
      }
    });

    // Remove client
    this.clients.delete(userId);

    logger.info(`WebSocket disconnected: ${userId} (code: ${code}, reason: ${reason})`);
  }

  /**
   * Send message to specific user
   */
  sendToUser(userId, message, appType) {
    const client = this.clients.get(userId);
    if (!client || client.appType !== appType) {
      logger.warn(`User ${userId} not found or app mismatch`);
      return false;
    }

    try {
      const messageStr = JSON.stringify(message);
      client.connection.send(messageStr);
      return true;
    } catch (error) {
      logger.error(`Failed to send message to ${userId}:`, error);
      return false;
    }
  }

  /**
   * Send message to multiple users
   */
  sendToUsers(userIds, message, appType) {
    const results = [];
    userIds.forEach(userId => {
      results.push(this.sendToUser(userId, message, appType));
    });
    return results;
  }

  /**
   * Send message to room
   */
  sendToRoom(roomId, message, appType) {
    const room = this.rooms.get(roomId);
    if (!room) {
      logger.warn(`Room ${roomId} not found`);
      return [];
    }

    const results = [];
    room.forEach(userId => {
      const client = this.clients.get(userId);
      if (client && client.appType === appType) {
        results.push(this.sendToUser(userId, message, appType));
      }
    });

    return results;
  }

  /**
   * Send message to all users in an app
   */
  sendToApp(appType, message) {
    const results = [];
    this.clients.forEach((client, userId) => {
      if (client.appType === appType) {
        results.push(this.sendToUser(userId, message, appType));
      }
    });
    return results;
  }

  /**
   * Send message to all admin users in an app
   */
  sendToAppAdmins(appType, message, appName) {
    const results = [];
    this.clients.forEach((client, userId) => {
      if (client.appType === appType && client?.appName === appName) {
        results.push(this.sendToUser(userId, message, appType, appName));
      }
    });
    return results;
  }

  /**
   * Join a room
   */
  joinRoom(userId, roomId) {
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
    setInterval(() => {
      const now = Date.now();
      this.clients.forEach((client, userId) => {
        if (now - client.lastPing > this.connectionTimeout) {
          logger.warn(`Connection timeout for ${userId}`);
          this.handleDisconnection(userId, 1000, 'Connection timeout');
        }
      });
    }, this.heartbeatInterval);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const stats = {
      totalConnections: this.clients.size,
      totalRooms: this.rooms.size,
      connectionsByApp: {},
      connectionsByType: {}
    };

    this.clients.forEach((client, userId) => {
      // Count by app
      stats.connectionsByApp[client.appName] = (stats.connectionsByApp[client.appName] || 0) + 1;
      
      // Count by type
      // stats.connectionsByType[client.userType] = (stats.connectionsByType[client.userType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const results = [];
    this.clients.forEach((client, userId) => {
      try {
        const messageStr = JSON.stringify(message);
        client.connection.send(messageStr);
        results.push({ userId, success: true });
      } catch (error) {
        logger.error(`Failed to broadcast to ${userId}:`, error);
        results.push({ userId, success: false, error: error.message });
      }
    });
    return results;
  }
}

module.exports = new WebSocketService(); 