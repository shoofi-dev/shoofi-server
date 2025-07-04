const { getId } = require("../lib/common");
const { getCustomerAppName } = require("./app-name-helper");
const notificationService = require("../services/notification/notification-service");
const logger = require("./logger");

/**
 * Persistent Alerts System for Store Managers
 * Manages persistent notifications for pending orders until they are approved
 */

class PersistentAlertsService {
  /**
   * Send persistent alert to store owners for a new order
   * @param {Object} orderDoc - Order document
   * @param {Object} req - Express request object
   * @param {string} appName - App name
   */
  async sendPersistentAlert(orderDoc, req, appName) {
    try {
      const shoofiDB = req.app.db["shoofi"];
      
      // Get all active store users for this app
      const storeUsers = await shoofiDB.storeUsers.find({
        appName: appName,
        // role: { $in: ["owner", "manager", "admin"] }
      }).toArray();

      if (storeUsers.length === 0) {
        logger.warn(`No active store users found for app: ${appName}`);
        return;
      }

      const orderId = orderDoc._id;
      const orderNumber = orderDoc.orderId;
      const customerName = orderDoc.customerName || "عميل";
      const orderTotal = orderDoc.orderPrice || 0;
      const orderItems = orderDoc.order?.items || [];

      // Create persistent alert record
      const alertRecord = {
        orderId: getId(orderId),
        orderNumber,
        appName,
        customerName,
        orderTotal,
        orderItems,
        status: "pending",
        createdAt: new Date(),
        lastReminderSent: null,
        reminderCount: 0,
        maxReminders: 5, // Maximum reminders before escalation
        reminderInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
        storeUsers: storeUsers.map(user => ({
          userId: user._id,
          name: user.fullName || user.name,
          role: user.role,
          notified: false
        }))
      };

      // Save alert record
      await shoofiDB.persistentAlerts.insertOne(alertRecord);

      // Send initial notifications to all store users
      const notificationPromises = storeUsers.map(user => 
        notificationService.sendNotification({
          recipientId: user._id,
          title: "طلب جديد يتطلب الموافقة",
          body: `طلب جديد رقم ${orderNumber} من ${customerName} بقيمة ${orderTotal} ريال`,
          data: {
            type: "new_order_alert",
            orderId: orderId,
            orderNumber,
            customerName,
            orderTotal,
            requiresApproval: true,
            alertId: alertRecord._id
          },
          type: "order_alert",
          appName,
          appType: "shoofi-partner",
          channels: { websocket: true, push: true, email: false, sms: false },
          req
        })
      );

      await Promise.allSettled(notificationPromises);

      // Update alert record with notification status
      await shoofiDB.persistentAlerts.updateOne(
        { _id: alertRecord._id },
        {
          $set: {
            "storeUsers.$[].notified": true,
            lastNotificationSent: new Date()
          }
        }
      );

      logger.info(`Persistent alert sent for order ${orderNumber} to ${storeUsers.length} store users`);

    } catch (error) {
      logger.error("Error sending persistent alert:", error);
      throw error;
    }
  }

  /**
   * Clear persistent alert when order is approved (isViewd = true)
   * @param {string} orderId - Order ID
   * @param {Object} req - Express request object
   * @param {string} appName - App name
   */
  async clearPersistentAlert(orderId, req, appName) {
    try {
      const shoofiDB = req.app.db["shoofi"];
      
      // Find and update the persistent alert
      const alert = await shoofiDB.persistentAlerts.findOne({
        orderId: getId(orderId),
        appName,
        status: "pending"
      });

      if (!alert) {
        logger.info(`No persistent alert found for order ${orderId}`);
        return;
      }

      // Update alert status to approved
      await shoofiDB.persistentAlerts.updateOne(
        { _id: alert._id },
        {
          $set: {
            status: "approved",
            approvedAt: new Date(),
            approvedBy: req.user?.id || "system"
          }
        }
      );

      // Send approval notification to store users
      const storeUsers = alert.storeUsers.filter(user => user.notified);
      
      const approvalPromises = storeUsers.map(user => 
        notificationService.sendNotification({
          recipientId: user.userId,
          title: "تمت الموافقة على الطلب",
          body: `تمت الموافقة على الطلب رقم ${alert.orderNumber} من ${alert.customerName}`,
          data: {
            type: "order_approved",
            orderId: orderId,
            orderNumber: alert.orderNumber,
            customerName: alert.customerName,
            alertId: alert._id
          },
          type: "order_alert",
          appName,
          appType: "shoofi-partner",
          channels: { websocket: true, push: true, email: false, sms: false },
          req
        })
      );

      await Promise.allSettled(approvalPromises);

      logger.info(`Persistent alert cleared for order ${alert.orderNumber}`);

    } catch (error) {
      logger.error("Error clearing persistent alert:", error);
      throw error;
    }
  }

  /**
   * Get pending orders that need approval
   * @param {Object} req - Express request object
   * @param {string} appName - App name
   * @param {string} userId - User ID (optional, for filtering)
   */
  async getPendingOrders(req, appName, userId = null) {
    try {
      const shoofiDB = req.app.db["shoofi"];
      
      let query = {
        appName,
        status: "pending"
      };

      if (userId) {
        query["storeUsers.userId"] = getId(userId);
      }

      const pendingAlerts = await shoofiDB.persistentAlerts.find(query)
        .sort({ createdAt: -1 })
        .toArray();

      return pendingAlerts;

    } catch (error) {
      logger.error("Error getting pending orders:", error);
      throw error;
    }
  }

  /**
   * Send reminder notifications for pending orders
   * This should be called by a cron job
   * @param {Object} req - Express request object
   */
  async sendReminders(db) {
    try {
      const shoofiDB = db["shoofi"];
      const now = new Date();
      
      // Find alerts that need reminders
      const alertsNeedingReminders = await shoofiDB.persistentAlerts.find({
        status: "pending",
        $or: [
          { lastReminderSent: null },
          {
            lastReminderSent: {
              $lt: new Date(now.getTime() - 5 * 60 * 1000) // 5 minutes ago
            }
          }
        ],
        reminderCount: { $lt: 5 } // Max 5 reminders
      }).toArray();

      for (const alert of alertsNeedingReminders) {
        const storeUsers = alert.storeUsers.filter(user => user.notified);
        
        const reminderPromises = storeUsers.map(user => 
          notificationService.sendNotification({
            recipientId: user.userId,
            title: "تذكير: طلب في انتظار الموافقة",
            body: `طلب رقم ${alert.orderNumber} من ${alert.customerName} لا يزال في انتظار الموافقة`,
            data: {
              type: "order_reminder",
              orderId: alert.orderId,
              orderNumber: alert.orderNumber,
              customerName: alert.customerName,
              alertId: alert._id,
              reminderCount: alert.reminderCount + 1
            },
            type: "order_alert",
            appName: alert.appName,
            appType: "shoofi-partner",
            channels: { websocket: true, push: true, email: false, sms: false },
            req:{
              app: {
                db: db,
                appName: alert.appName
              }
            }
          })
        );

        await Promise.allSettled(reminderPromises);

        // Update reminder count and last reminder sent
        await shoofiDB.persistentAlerts.updateOne(
          { _id: alert._id },
          {
            $set: {
              lastReminderSent: now
            },
            $inc: {
              reminderCount: 1
            }
          }
        );

        logger.info(`Reminder sent for order ${alert.orderNumber} (reminder #${alert.reminderCount + 1})`);
      }

    } catch (error) {
      logger.error("Error sending reminders:", error);
      throw error;
    }
  }

  /**
   * Get alert statistics
   * @param {Object} req - Express request object
   * @param {string} appName - App name
   */
  async getAlertStats(req, appName) {
    try {
      const shoofiDB = req.app.db["shoofi"];
      
      const stats = await shoofiDB.persistentAlerts.aggregate([
        { $match: { appName } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            avgResponseTime: {
              $avg: {
                $cond: [
                  { $eq: ["$status", "approved"] },
                  { $subtract: ["$approvedAt", "$createdAt"] },
                  null
                ]
              }
            }
          }
        }
      ]).toArray();

      return stats;

    } catch (error) {
      logger.error("Error getting alert stats:", error);
      throw error;
    }
  }
}

module.exports = new PersistentAlertsService(); 