# WebSocket System Improvements

## Overview

This document outlines the improvements made to the WebSocket system to make it more reliable, scalable, and production-ready.

## Key Improvements

### 1. **Redis Integration for Scalability**
- **Cross-server communication**: Multiple server instances can now communicate via Redis pub/sub
- **Connection persistence**: User connections are stored in Redis for server restart resilience
- **Message queuing**: Messages sent to offline users are queued and delivered when they reconnect

### 2. **Enhanced Authentication**
- **JWT verification**: Proper token validation for secure connections
- **Parameter validation**: All required connection parameters are validated
- **Error handling**: Clear error messages for authentication failures

### 3. **Improved Connection Management**
- **Connection limits**: Prevents users from exceeding maximum connections
- **Server identification**: Each server instance has a unique ID for tracking
- **Graceful shutdown**: Proper cleanup on server restart/shutdown

### 4. **Better Error Handling**
- **Comprehensive logging**: Detailed error logs for debugging
- **Connection timeouts**: Automatic cleanup of stale connections
- **Retry mechanisms**: Exponential backoff for reconnection attempts

### 5. **Mobile App Optimizations**
- **Network state awareness**: Automatically handles network changes
- **App state management**: Disconnects when app goes to background
- **Message queuing**: Queues messages when offline, sends when reconnected
- **Heartbeat management**: Maintains connection health

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mobile App    │    │   Web Server    │    │      Redis      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ WebSocket   │◄┼────┼►│ WebSocket   │ │    │ │ Pub/Sub     │ │
│ │ Client      │ │    │ │ Service     │ │    │ │ Channels    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Message     │ │    │ │ Connection  │ │    │ │ Message     │ │
│ │ Queue       │ │    │ │ Manager     │ │    │ │ Queue       │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Implementation Steps

### 1. Install Dependencies

The required dependencies are already included in `package.json`:
- `ws`: WebSocket server
- `ioredis`: Redis client with better performance
- `jsonwebtoken`: JWT verification

### 2. Environment Variables

Add these to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your_jwt_secret_key

# WebSocket Configuration
WS_HEARTBEAT_INTERVAL=30000
WS_CONNECTION_TIMEOUT=60000
WS_MAX_CONNECTIONS_PER_USER=3
```

### 3. Initialize WebSocket Service

Update your `app.js` to initialize the improved WebSocket service:

```javascript
const websocketService = require('./services/websocket/websocket-service');
const redisManager = require('./config/redis');

// Initialize Redis first
await redisManager.init();

// Initialize WebSocket service
await websocketService.init(server);
```

### 4. Update Mobile App

Replace the existing WebSocket hook with the improved version:

```typescript
// In your mobile app
import useWebSocket from '../hooks/use-websocket';

const MyComponent = () => {
  const {
    isConnected,
    connectionStatus,
    lastMessage,
    error,
    sendMessage,
    reconnect,
    getStats
  } = useWebSocket();

  // Use the WebSocket connection
  useEffect(() => {
    if (lastMessage?.type === 'notification') {
      // Handle notification
      console.log('New notification:', lastMessage.data);
    }
  }, [lastMessage]);

  return (
    <View>
      <Text>Status: {connectionStatus}</Text>
      {error && <Text>Error: {error}</Text>}
      <Button title="Reconnect" onPress={reconnect} />
    </View>
  );
};
```

## Features

### 1. **Message Types**

The WebSocket system supports these message types:

#### From Client to Server:
- `ping`: Heartbeat message
- `join_room`: Join a specific room
- `leave_room`: Leave a specific room

#### From Server to Client:
- `pong`: Heartbeat response
- `notification`: Push notification
- `order_update`: Order status update
- `system_announcement`: System-wide message
- `connection_established`: Connection confirmation

### 2. **Room Management**

Users can join/leave rooms for targeted messaging:

```javascript
// Join a room
sendMessage({
  type: 'join_room',
  data: { room: 'orders' }
});

// Leave a room
sendMessage({
  type: 'leave_room',
  data: { room: 'orders' }
});
```

### 3. **Targeted Messaging**

Send messages to specific users, rooms, or app types:

```javascript
// Send to specific user
websocketService.sendToUser('user123', {
  type: 'order_update',
  data: { orderId: '123', status: 'delivered' }
}, 'shoofi-app');

// Send to room
websocketService.sendToRoom('orders', {
  type: 'system_announcement',
  data: { message: 'New orders available' }
}, 'shoofi-app');

// Send to all users in app
websocketService.sendToApp('shoofi-app', {
  type: 'maintenance_notice',
  data: { message: 'Scheduled maintenance' }
});
```

### 4. **Message Queuing**

Messages sent to offline users are automatically queued:

```javascript
// This will be queued if user is offline
websocketService.sendToUser('offline_user', {
  type: 'notification',
  data: { title: 'New Order', body: 'Order #123 received' }
}, 'shoofi-app');
```

## Monitoring and Debugging

### 1. **Connection Statistics**

Get real-time connection statistics:

```javascript
const stats = await websocketService.getStats();
console.log(stats);
// {
//   totalConnections: 150,
//   totalRooms: 5,
//   connectionsByApp: { 'shoofi-app': 100, 'shoofi-partner': 50 },
//   connectionsByType: { 'customer': 120, 'admin': 30 },
//   serverId: 'server_1234567890_abc123',
//   totalRedisConnections: 150,
//   totalQueuedMessages: 25
// }
```

### 2. **Redis Health Check**

Monitor Redis connection health:

```javascript
const redisHealth = await redisManager.healthCheck();
console.log(redisHealth);
// {
//   status: 'healthy',
//   latency: 5,
//   connections: {
//     main: 'ready',
//     subscriber: 'ready',
//     publisher: 'ready'
//   }
// }
```

### 3. **Logging**

The system provides comprehensive logging:

```javascript
// Connection events
logger.info('WebSocket connected: user123 (shoofi-app)');
logger.warn('Connection timeout for user456');
logger.error('Failed to send message to user789');

// Redis events
logger.info('Redis connected for WebSocket service');
logger.error('Redis connection error:', error);
```

## Performance Optimizations

### 1. **Connection Limits**
- Maximum 3 connections per user
- Automatic cleanup of stale connections
- Heartbeat monitoring every 30 seconds

### 2. **Message Efficiency**
- JSON compression for large messages
- Batch processing for multiple recipients
- Automatic message expiration (7 days)

### 3. **Memory Management**
- Connection data expires after 5 minutes
- Automatic cleanup of empty rooms
- Graceful shutdown procedures

## Security Considerations

### 1. **Authentication**
- JWT token verification on connection
- Parameter validation
- Rate limiting for connection attempts

### 2. **Data Protection**
- Message encryption (if needed)
- Input sanitization
- Access control by app type

### 3. **Network Security**
- HTTPS/WSS for production
- Firewall configuration
- DDoS protection

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check network connectivity
   - Verify Redis is running
   - Check JWT token validity

2. **Message Delivery Failures**
   - Verify user is connected
   - Check app type matching
   - Review server logs

3. **Redis Connection Issues**
   - Verify Redis server is running
   - Check connection credentials
   - Monitor Redis memory usage

### Debug Commands

```javascript
// Check WebSocket status
const wsStats = websocketService.getStats();

// Check Redis health
const redisHealth = await redisManager.healthCheck();

// Test message delivery
const result = await websocketService.sendToUser('test_user', {
  type: 'test',
  data: { message: 'Test message' }
}, 'shoofi-app');
```

## Migration Guide

### From Old WebSocket System

1. **Backup current data**
2. **Install Redis** (if not already installed)
3. **Update environment variables**
4. **Deploy new WebSocket service**
5. **Update mobile apps**
6. **Monitor for issues**

### Rollback Plan

If issues occur:
1. Revert to old WebSocket service
2. Remove Redis dependency
3. Update mobile apps to use old connection method

## Future Enhancements

1. **Message Encryption**: End-to-end encryption for sensitive data
2. **Load Balancing**: Multiple WebSocket servers behind a load balancer
3. **Analytics**: Detailed connection and message analytics
4. **Push Notifications**: Fallback to push notifications when WebSocket fails
5. **Message History**: Persistent message history for users

## Support

For issues or questions:
1. Check the logs in `logs/error.log`
2. Review Redis connection status
3. Verify environment variables
4. Test with a simple WebSocket client 