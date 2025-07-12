const logger = require('../../utils/logger');
const { getId } = require('../../lib/common');
const moment = require('moment');

class CentralizedFlowMonitor {
  constructor() {
    // Use the main shoofi database for centralized storage
    this.getCentralDb = () => {
      if (global.app && global.app.db && global.app.db['shoofi']) {
        // If it's a db object (test context), return the collection directly
        if (typeof global.app.db['shoofi'].collection === 'function') {
          return global.app.db['shoofi'].collection('orderFlowEvents');
        }
        // Otherwise, assume it's the app's db map
        return global.app.db['shoofi'];
      }
      throw new Error('Centralized DB not initialized');
    };
  }

  /**
   * Track order flow event centrally
   */
  async trackOrderFlowEvent(params) {
    const {
      orderId,
      orderNumber,
      sourceApp, // 'shoofi-app', 'shoofi-partner', 'shoofi-shoofir', 'delivery-company'
      eventType,
      status,
      actor,
      actorId,
      actorType,
      metadata = {},
      timestamp = new Date()
    } = params;

    const event = {
      orderId: getId(orderId),
      orderNumber,
      sourceApp,
      eventType,
      status,
      actor,
      actorId: getId(actorId),
      actorType,
      metadata,
      timestamp,
      createdAt: new Date()
    };

    try {
      const collection = this.getCentralDb();
      const result = await collection.insertOne(event);
      
      logger.info(`Centralized Flow Event: ${eventType} for order ${orderNumber}`, {
        eventId: result.insertedId,
        sourceApp,
        orderId: event.orderId
      });

      return { ...event, _id: result.insertedId };
    } catch (error) {
      logger.error('Failed to track centralized flow event:', error);
      throw error;
    }
  }

  /**
   * Track notification events
   */
  async trackNotificationEvent(orderId, orderNumber, sourceApp, notificationType, recipientId, recipientType, status, metadata = {}) {
    return this.trackOrderFlowEvent({
      orderId,
      orderNumber,
      sourceApp,
      eventType: `notification_${notificationType}`,
      status,
      actor: 'System',
      actorId: 'system',
      actorType: 'system',
      metadata: {
        ...metadata,
        recipientId: getId(recipientId),
        recipientType,
        notificationType
      }
    });
  }

  /**
   * Track WebSocket events
   */
  async trackWebSocketEvent(orderId, orderNumber, sourceApp, wsEventType, recipientId, recipientType, status, metadata = {}) {
    return this.trackOrderFlowEvent({
      orderId,
      orderNumber,
      sourceApp,
      eventType: `websocket_${wsEventType}`,
      status,
      actor: 'System',
      actorId: 'system',
      actorType: 'system',
      metadata: {
        ...metadata,
        recipientId: getId(recipientId),
        recipientType,
        wsEventType
      }
    });
  }

  /**
   * Get complete order timeline with all events
   */
  async getCompleteOrderTimeline(orderNumber) {
    try {
      const collection = this.getCentralDb();
      // Get all events for this order
      const events = await collection
        .find({ orderNumber })
        .sort({ timestamp: 1 })
        .toArray();

      // Get delivery information
      const deliveryEvents = await collection
        .find({ 
          orderNumber,
          sourceApp: 'delivery-company'
        })
        .sort({ timestamp: 1 })
        .toArray();

      return {
        orderNumber,
        events,
        deliveryEvents,
        totalEvents: events.length,
        timeline: this.buildTimeline(events)
      };
    } catch (error) {
      logger.error('Failed to get complete order timeline:', error);
      throw error;
    }
  }

  /**
   * Build chronological timeline
   */
  buildTimeline(events) {
    return events.map(event => ({
      id: event._id,
      timestamp: event.timestamp,
      sourceApp: event.sourceApp,
      eventType: event.eventType,
      status: event.status,
      actor: event.actor,
      actorType: event.actorType,
      metadata: event.metadata,
      timeAgo: moment(event.timestamp).fromNow()
    }));
  }

  /**
   * Get order status summary
   */
  async getOrderStatusSummary(orderNumber) {
    try {
      const collection = this.getCentralDb();
      const events = await collection
        .find({ orderNumber })
        .sort({ timestamp: -1 })
        .toArray();

      const latestEvent = events[0];
      const notificationEvents = events.filter(e => e.eventType.startsWith('notification_'));
      const websocketEvents = events.filter(e => e.eventType.startsWith('websocket_'));
      const deliveryEvents = events.filter(e => e.sourceApp === 'delivery-company');

      return {
        orderNumber,
        currentStatus: latestEvent?.status || 'unknown',
        lastEvent: latestEvent?.eventType || 'none',
        lastEventTime: latestEvent?.timestamp,
        totalEvents: events.length,
        notificationsSent: notificationEvents.length,
        websocketsSent: websocketEvents.length,
        deliveryEvents: deliveryEvents.length,
        timeline: this.buildTimeline(events)
      };
    } catch (error) {
      logger.error('Failed to get order status summary:', error);
      throw error;
    }
  }

  /**
   * Search orders by criteria
   */
  async searchOrders(criteria) {
    try {
      const collection = this.getCentralDb();
      const { status, startDate, endDate, sourceApp, limit = 50 } = criteria;
      
      let query = {};
      if (status) query.status = status;
      if (sourceApp) query.sourceApp = sourceApp;
      if (startDate && endDate) {
        query.timestamp = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      const events = await collection
        .find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      // Group by order number
      const orderGroups = {};
      events.forEach(event => {
        if (!orderGroups[event.orderNumber]) {
          orderGroups[event.orderNumber] = [];
        }
        orderGroups[event.orderNumber].push(event);
      });

      const results = Object.keys(orderGroups).map(orderNumber => ({
        orderNumber,
        events: orderGroups[orderNumber],
        latestEvent: orderGroups[orderNumber][0],
        totalEvents: orderGroups[orderNumber].length
      }));

      return {
        results,
        total: results.length,
        query
      };
    } catch (error) {
      logger.error('Failed to search orders:', error);
      throw error;
    }
  }

  /**
   * Clean up old events (optional)
   */
  async cleanupOldEvents(daysToKeep = 90) {
    try {
      const db = this.getCentralDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await db.orderFlowEvents.deleteMany({
        timestamp: { $lt: cutoffDate }
      });

      logger.info(`Cleaned up ${result.deletedCount} old events`);
      return result.deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old events:', error);
      throw error;
    }
  }
}

module.exports = new CentralizedFlowMonitor(); 