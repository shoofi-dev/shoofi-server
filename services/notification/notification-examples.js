const notificationService = require('./notification-service');

// Example usage of the enhanced notification service

/**
 * Example 1: Send notification with custom sound and maximum volume
 */
async function sendCustomSoundNotification(req, userId, title, body) {
  try {
    await notificationService.sendNotification({
      recipientId: userId,
      title,
      body,
      data: { orderId: '12345' },
      soundType: 'buffalosound.wav', // Custom sound file
      appName: 'shoofi-app',
      req,
      channels: { websocket: true, push: true, email: false, sms: false }
    });
    console.log('Custom sound notification sent successfully');
  } catch (error) {
    console.error('Failed to send custom sound notification:', error);
  }
}

/**
 * Example 2: Send order notification with delivery sound
 */
async function sendOrderNotification(req, userId, orderId) {
  try {
    await notificationService.sendOrderNotification({
      recipientId: userId,
      title: 'New Order Received!',
      body: `Order #${orderId} has been placed successfully.`,
      data: { orderId, type: 'new_order' },
      appName: 'shoofi-app',
      req
    });
    console.log('Order notification sent with delivery sound');
  } catch (error) {
    console.error('Failed to send order notification:', error);
  }
}

/**
 * Example 3: Send urgent notification with buffalo sound
 */
async function sendUrgentNotification(req, userId, message) {
  try {
    await notificationService.sendUrgentNotification({
      recipientId: userId,
      title: 'URGENT: Action Required',
      body: message,
      data: { priority: 'high', type: 'urgent' },
      appName: 'shoofi-app',
      req
    });
    console.log('Urgent notification sent with buffalo sound');
  } catch (error) {
    console.error('Failed to send urgent notification:', error);
  }
}

/**
 * Example 4: Send system notification with default sound
 */
async function sendSystemNotification(req, userId, message) {
  try {
    await notificationService.sendSystemNotification({
      recipientId: userId,
      title: 'System Update',
      body: message,
      data: { type: 'system_update' },
      appName: 'shoofi-app',
      req
    });
    console.log('System notification sent with default sound');
  } catch (error) {
    console.error('Failed to send system notification:', error);
  }
}

/**
 * Example 5: Send notification with different sound for different app types
 */
async function sendAppSpecificNotification(req, userId, title, body, appType) {
  try {
    // Choose sound based on app type
    let soundType = 'buffalosound.wav'; // default
    
    if (appType === 'shoofi-shoofir') {
      soundType = 'deliverysound.wav'; // delivery drivers get delivery sound
    } else if (appType === 'shoofi-partner') {
      soundType = 'buffalosound.wav'; // partners get buffalo sound
    }
    
    await notificationService.sendNotification({
      recipientId: userId,
      title,
      body,
      data: { appType, type: 'app_specific' },
      soundType,
      appName: appType,
      appType,
      req
    });
    console.log(`App-specific notification sent with ${soundType}`);
  } catch (error) {
    console.error('Failed to send app-specific notification:', error);
  }
}

module.exports = {
  sendCustomSoundNotification,
  sendOrderNotification,
  sendUrgentNotification,
  sendSystemNotification,
  sendAppSpecificNotification
}; 