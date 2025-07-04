const express = require('express');
const router = express.Router();
const notificationService = require('../services/notification/notification-service');
const { getId } = require('../lib/common');
const { getCustomerAppName } = require('../utils/app-name-helper');
const logger = require('../utils/logger');

/**
 * @route POST /api/notifications/send
 * @desc Send notification to user(s)
 * @access Private
 */
router.post('/send', async (req, res) => {
  try {
    const {
      recipientIds, // Array of user IDs
      title,
      body,
      data = {},
      type = 'system',
      channels = { websocket: true, push: true, email: false, sms: false }
    } = req.body;

    const appName = req.headers['app-name'];
    
    if (!recipientIds || !title || !body || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: recipientIds, title, body, app-name header'
      });
    }

    const results = [];
    
    // Send to each recipient
    for (const recipientId of recipientIds) {
      try {
        const result = await notificationService.sendNotification({
          recipientId,
          title,
          body,
          data,
          type,
          appName,
          channels,
          req
        });
        
        results.push({
          recipientId,
          success: true,
          notificationId: result?._id
        });
      } catch (error) {
        logger.error(`Failed to send notification to ${recipientId}:`, error);
        results.push({
          recipientId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    res.status(200).json({
      success: true,
      message: `Notifications sent: ${successCount} successful, ${failureCount} failed`,
      results
    });

  } catch (error) {
    logger.error('Error in send notification route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route POST /api/notifications/send-to-app
 * @desc Send notification to all users in an app
 * @access Private
 */
router.post('/send-to-app', async (req, res) => {
  try {
    const {
      title,
      body,
      data = {},
      type = 'system',
      channels = { websocket: true, push: true, email: false, sms: false },
      adminOnly = false
    } = req.body;

    const appName = req.headers['app-name'];
    
    if (!title || !body || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, body, app-name header'
      });
    }

    // Get all users from the app
    const customerDB = getCustomerAppName(req, appName);
    const query = {};
    
    if (adminOnly) {
      query.isAdmin = true;
    }

    const users = await customerDB.customers.find(query).toArray();
    
    if (users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users found to send notifications to',
        results: []
      });
    }

    const results = [];
    
    // Send to each user
    for (const user of users) {
      try {
        const result = await notificationService.sendNotification({
          recipientId: user._id.toString(),
          title,
          body,
          data,
          type,
          appName,
          channels,
          req
        });
        
        results.push({
          recipientId: user._id.toString(),
          success: true,
          notificationId: result?._id
        });
      } catch (error) {
        logger.error(`Failed to send notification to ${user._id}:`, error);
        results.push({
          recipientId: user._id.toString(),
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    res.status(200).json({
      success: true,
      message: `Notifications sent: ${successCount} successful, ${failureCount} failed`,
      totalUsers: users.length,
      results
    });

  } catch (error) {
    logger.error('Error in send-to-app notification route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route GET /api/notifications
 * @desc Get user notifications
 * @access Private
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, unreadOnly = false } = req.query;
    const userId = req.user?.id || req.headers['user-id'];
    const appName = req.headers['app-name'];

    if (!userId || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user-id header, app-name header'
      });
    }

    const notifications = await notificationService.getUserNotifications(
      userId,
      appName,
      req,
      {
        limit: parseInt(limit),
        offset: parseInt(offset),
        unreadOnly: unreadOnly === 'true'
      }
    );

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        count: notifications.length
      }
    });

  } catch (error) {
    logger.error('Error in get notifications route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route PUT /api/notifications/:id/read
 * @desc Mark notification as read
 * @access Private
 */
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const appName = req.headers['app-name'];

    if (!id || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: notification id, app-name header'
      });
    }

    const success = await notificationService.markAsRead(id, appName, req);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Notification marked as read'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

  } catch (error) {
    logger.error('Error in mark notification as read route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route PUT /api/notifications/read-all
 * @desc Mark all user notifications as read
 * @access Private
 */
router.put('/read-all', async (req, res) => {
  try {
    const userId = req.user?.id || req.headers['user-id'];
    const appName = req.headers['app-name'];

    if (!userId || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user-id header, app-name header'
      });
    }

    const customerDB = getCustomerAppName(req, appName);
    
    const result = await customerDB.notifications.updateMany(
      { 
        recipientId: getId(userId),
        isRead: false
      },
      { 
        $set: { 
          isRead: true, 
          readAt: new Date() 
        } 
      }
    );

    res.status(200).json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`
    });

  } catch (error) {
    logger.error('Error in mark all notifications as read route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route DELETE /api/notifications/:id
 * @desc Delete notification
 * @access Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.headers['user-id'];
    const appName = req.headers['app-name'];

    if (!id || !userId || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: notification id, user-id header, app-name header'
      });
    }

    const customerDB = getCustomerAppName(req, appName);
    
    const result = await customerDB.notifications.deleteOne({
      _id: getId(id),
      recipientId: getId(userId)
    });

    if (result.deletedCount > 0) {
      res.status(200).json({
        success: true,
        message: 'Notification deleted'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

  } catch (error) {
    logger.error('Error in delete notification route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route GET /api/notifications/stats
 * @desc Get notification statistics
 * @access Private
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user?.id || req.headers['user-id'];
    const appName = req.headers['app-name'];

    if (!userId || !appName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: user-id header, app-name header'
      });
    }

    const customerDB = getCustomerAppName(req, appName);
    
    const [total, unread, byType] = await Promise.all([
      customerDB.notifications.countDocuments({ recipientId: getId(userId) }),
      customerDB.notifications.countDocuments({ 
        recipientId: getId(userId), 
        isRead: false 
      }),
      customerDB.notifications.aggregate([
        { $match: { recipientId: getId(userId) } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]).toArray()
    ]);

    const typeStats = {};
    byType.forEach(item => {
      typeStats[item._id] = item.count;
    });

    res.status(200).json({
      success: true,
      data: {
        total,
        unread,
        read: total - unread,
        byType: typeStats
      }
    });

  } catch (error) {
    logger.error('Error in get notification stats route:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router; 