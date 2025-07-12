const { Expo } = require("expo-server-sdk");
const firebaseAdmin = require('firebase-admin');
const { getId } = require("../../lib/common");
const { getCustomerAppName } = require("../../utils/app-name-helper");
const websocketService = require("../../services/websocket/websocket-service");
const centralizedFlowMonitor = require("../monitoring/centralized-flow-monitor");
const logger = require("../../utils/logger");

// Helper function to get customer based on app type (same logic as customer.js)
const getCustomerByAppType = async (req, customerId, appType) => {
  let customer = null;
  let customerDB = null;
  let collection = null;
  
  if(appType === 'shoofi-shoofir'){
    const deliveryDB = req.app.db['delivery-company'];
    customer = await deliveryDB.customers.findOne({ _id: getId(customerId) });
    customerDB = deliveryDB;
    collection = "customers";
  }else if(appType === 'shoofi-partner'){
    const shoofiDB = req.app.db['shoofi'];
    customer = await shoofiDB.storeUsers.findOne({ _id: getId(customerId) });
    customerDB = shoofiDB;
    collection = "storeUsers";
  }else{
    const shoofiDB = req.app.db['shoofi'];
    customer = await shoofiDB.customers.findOne({ _id: getId(customerId) });
    customerDB = shoofiDB;
    collection = "customers";
  }
  
  return { customer, customerDB, collection };
};

class NotificationService {
  constructor() {
    this.expo = new Expo();
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Send notification to multiple channels
   * @param {Object} options
   * @param {string} options.recipientId - User ID
   * @param {string} options.title - Notification title
   * @param {string} options.body - Notification body
   * @param {Object} options.data - Additional data
   * @param {string} options.type - Notification type (order, system, alert, etc.)
   * @param {string} options.appName - App name
   * @param {string} options.appType - App type (shoofi-app, shoofi-shoofir, shoofi-partner)
   * @param {Object} options.channels - Channels to send to { websocket: boolean, push: boolean, email: boolean, sms: boolean }
   * @param {Object} options.req - Express request object
   * @param {string} options.soundType - Custom sound file name (e.g., 'buffalosound.wav', 'deliverysound.wav')
   */
  async sendNotification(options) {
    const {
      recipientId,
      title,
      body,
      data = {},
      type = 'system',
      appName,
      appType = req?.headers?.['app-type'] || 'shoofi-app',
      channels = { websocket: true, push: true, email: false, sms: false },
      req,
      soundType = 'buffalosound.wav'
    } = options;

    try {
      // Track notification attempt
      if (data?.orderId || data?.orderNumber) {
        await centralizedFlowMonitor.trackNotificationEvent(
          data.orderId,
          data.orderNumber || data.bookId,
          appName,
          'attempt',
          recipientId,
          appType,
          'pending',
          { title, body, type, channels }
        );
      }

      // Get user details using app type logic
      const { customer: user, customerDB, collection } = await getCustomerByAppType(req, recipientId, appType);

      if (!user) {
        logger.warn(`User not found for notification: ${recipientId} in ${collection} collection`);
        return;
      }

      // Create notification record in database
      const notificationRecord = await this.createNotificationRecord(
        customerDB,
        getId(recipientId),
        title,
        body,
        type,
        data
      );

      // Send to different channels
      const promises = [];
      const results = {};

      if (channels.websocket) {
        try {
          const wsResult = await this.sendWebSocketNotification(recipientId, title, body, data, type, appName);
          results.websocket = 'sent';
          
          // Track WebSocket success
          if (data?.orderId || data?.orderNumber) {
            await centralizedFlowMonitor.trackWebSocketEvent(
              data.orderId,
              data.orderNumber || data.bookId,
              appName,
              'sent',
              recipientId,
              appType,
              'success',
              { type, data }
            );
          }
        } catch (error) {
          results.websocket = 'failed';
          logger.error('WebSocket notification failed:', error);
          
          // Track WebSocket failure
          if (data?.orderId || data?.orderNumber) {
            await centralizedFlowMonitor.trackWebSocketEvent(
              data.orderId,
              data.orderNumber || data.bookId,
              appName,
              'failed',
              recipientId,
              appType,
              'failed',
              { type, data, error: error.message }
            );
          }
        }
      }

      if (channels.push && user.notificationToken) {
        try {
          // Add sound type to data for push notifications
          const pushData = { ...data, soundType };
          const pushResult = await this.sendPushNotification(user.notificationToken, title, body, pushData, appName);
          results.push = 'sent';
          
          // Track push notification success
          if (data?.orderId || data?.orderNumber) {
            await centralizedFlowMonitor.trackNotificationEvent(
              data.orderId,
              data.orderNumber || data.bookId,
              appName,
              'push_sent',
              recipientId,
              appType,
              'success',
              { title, body, type }
            );
          }
        } catch (error) {
          results.push = 'failed';
          logger.error('Push notification failed:', error);
          
          // Track push notification failure
          if (data?.orderId || data?.orderNumber) {
            await centralizedFlowMonitor.trackNotificationEvent(
              data.orderId,
              data.orderNumber || data.bookId,
              appName,
              'push_failed',
              recipientId,
              appType,
              'failed',
              { title, body, type, error: error.message }
            );
          }
        }
      }

      if (channels.email && user.email) {
        try {
          await this.sendEmailNotification(user.email, title, body, data);
          results.email = 'sent';
        } catch (error) {
          results.email = 'failed';
          logger.error('Email notification failed:', error);
        }
      }

      if (channels.sms && user.phone) {
        try {
          await this.sendSMSNotification(user.phone, title, body);
          results.sms = 'sent';
        } catch (error) {
          results.sms = 'failed';
          logger.error('SMS notification failed:', error);
        }
      }

      // Track overall notification result
      if (data?.orderId || data?.orderNumber) {
        const overallStatus = Object.values(results).every(r => r === 'sent') ? 'success' : 'partial';
        await centralizedFlowMonitor.trackNotificationEvent(
          data.orderId,
          data.orderNumber || data.bookId,
          appName,
          'complete',
          recipientId,
          appType,
          overallStatus,
          { results }
        );
      }

      return { ...notificationRecord, results };

    } catch (error) {
      logger.error('Error sending notification:', error);
      
      // Track notification error
      if (data?.orderId || data?.orderNumber) {
        await centralizedFlowMonitor.trackNotificationEvent(
          data.orderId,
          data.orderNumber || data.bookId,
          appName,
          'error',
          recipientId,
          appType,
          'failed',
          { title, body, type, error: error.message }
        );
      }
      
      throw error;
    }
  }

  /**
   * Create notification record in database
   */
  async createNotificationRecord(db, recipientId, title, body, type, data) {
    const notification = {
      recipientId: String(getId(recipientId)),
      title,
      body,
      type,
      isRead: false,
      createdAt: new Date(),
      data,
      deliveryStatus: {
        websocket: 'pending',
        push: 'pending',
        email: 'pending',
        sms: 'pending'
      }
    };

    const result = await db.notifications.insertOne(notification);
    return { ...notification, _id: result.insertedId };
  }

  /**
   * Send WebSocket notification
   */
  async sendWebSocketNotification(recipientId, title, body, data, type, appName) {
    try {
      await websocketService.sendToUser(recipientId, {
        type: 'notification',
        data: {
          title,
          body,
          data,
          type,
          timestamp: new Date().toISOString()
        }
      }, appName);
      
      return { success: true, channel: 'websocket' };
    } catch (error) {
      logger.error('WebSocket notification failed:', error);
      throw error;
    }
  }

  /**
   * Send push notification with retry mechanism
   */
  async sendPushNotification(token, title, body, data, appName) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Determine if it's Expo or Firebase token
        if (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) {
          return await this.sendExpoPushNotification(token, title, body, data);
        } else {
          return await this.sendFirebasePushNotification(token, title, body, data);
        }
      } catch (error) {
        lastError = error;
        logger.warn(`Push notification attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }

    throw lastError;
  }

  /**
   * Send Expo push notification
   */
  async sendExpoPushNotification(token, title, body, data) {
    // Choose sound based on notification type or use default
    const soundType = data?.soundType || 'buffalosound.wav';
    
    const message = {
      to: token,
      sound: soundType, // Use custom sound file
      title,
      body,
      data,
      priority: 'high',
      volume: 1.0 // Maximum volume (0.0 to 1.0)
    };

    const chunks = this.expo.chunkPushNotifications([message]);
    const tickets = [];

    for (let chunk of chunks) {
      const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    return { success: true, channel: 'push', provider: 'expo', tickets };
  }

  /**
   * Send Firebase push notification
   */
  async sendFirebasePushNotification(token, title, body, data) {
    // Choose sound based on notification type or use default
    const soundType = data?.soundType || 'buffalosound.wav';
    
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      token,
      android: {
        priority: 'high',
        notification: {
          sound: soundType, // Use custom sound file
          volume: 1.0 // Maximum volume
        }
      },
      apns: {
        payload: {
          aps: {
            sound: soundType, // Use custom sound file
            volume: 1.0 // Maximum volume
          }
        }
      }
    };

    const response = await firebaseAdmin.messaging().send(message);
    return { success: true, channel: 'push', provider: 'firebase', response };
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(email, title, body, data) {
    // Implement email service integration
    // This is a placeholder - you can integrate with SendGrid, AWS SES, etc.
    logger.info(`Email notification would be sent to ${email}: ${title}`);
    return { success: true, channel: 'email' };
  }

  /**
   * Send SMS notification
   */
  async sendSMSNotification(phone, title, body) {
    // Implement SMS service integration
    // This is a placeholder - you can integrate with Twilio, AWS SNS, etc.
    logger.info(`SMS notification would be sent to ${phone}: ${title}`);
    return { success: true, channel: 'sms' };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, appName, req, appType = req?.headers?.['app-type'] || 'shoofi-app') {
    // Get the correct database based on app type
    let customerDB;
    if(appType === 'shoofi-shoofir'){
      customerDB = req.app.db['delivery-company'];
    }else if(appType === 'shoofi-partner'){
      customerDB = req.app.db['shoofi'];
    }else{
      customerDB = req.app.db['shoofi'];
    }
    
    const result = await customerDB.notifications.updateOne(
      { _id: getId(notificationId) },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId, appName, req, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false } = options;
    const appType = req?.headers?.['app-type'] || 'shoofi-app';
    
    // Get the correct database based on app type
    let customerDB;
    if(appType === 'shoofi-shoofir'){
      customerDB = req.app.db['delivery-company'];
    }else if(appType === 'shoofi-partner'){
      customerDB = req.app.db['shoofi'];
    }else{
      customerDB = req.app.db['shoofi'];
    }

    const query = { recipientId: String(getId(userId)) };
    if (unreadOnly) {
      query.isRead = false;
    }

    const notifications = await customerDB.notifications
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return notifications;
  }

  /**
   * Send order notification with delivery sound
   */
  async sendOrderNotification(options) {
    return this.sendNotification({
      ...options,
      soundType: 'deliverysound.wav',
      type: 'order'
    });
  }

  /**
   * Send urgent notification with buffalo sound
   */
  async sendUrgentNotification(options) {
    return this.sendNotification({
      ...options,
      soundType: 'buffalosound.wav',
      type: 'urgent'
    });
  }

  /**
   * Send system notification with default sound
   */
  async sendSystemNotification(options) {
    return this.sendNotification({
      ...options,
      soundType: 'default',
      type: 'system'
    });
  }

  /**
   * Send print notification to store users
   */
  async sendPrintNotification(options) {
    return this.sendNotification({
      ...options,
      soundType: 'buffalosound.wav', // Use buffalo sound for print notifications
      type: 'print_order',
      channels: {
        websocket: true,
        push: false, // Don't send push notifications for print
        email: false,
        sms: false
      }
    });
  }

  /**
   * Send unprinted order notification
   */
  async sendUnprintedNotification(options) {
    return this.sendNotification({
      ...options,
      soundType: 'buffalosound.wav',
      type: 'print_not_printed',
      channels: {
        websocket: true,
        push: false,
        email: false,
        sms: false
      }
    });
  }

  /**
   * Utility function for delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new NotificationService(); 