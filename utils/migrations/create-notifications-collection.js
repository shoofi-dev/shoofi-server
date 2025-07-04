const { ObjectId } = require('mongodb');

/**
 * Migration script to create notifications collection and indexes
 */
async function createNotificationsCollection(db) {
  try {
    console.log('Creating notifications collection...');

    // Create notifications collection if it doesn't exist
    const collections = await db.listCollections().toArray();
    const notificationsExists = collections.some(col => col.name === 'notifications');

    if (!notificationsExists) {
      await db.createCollection('notifications');
      console.log('Notifications collection created');
    }

    // Create indexes for better performance
    await db.notifications.createIndex(
      { recipientId: 1, createdAt: -1 },
      { name: 'recipientId_createdAt_idx' }
    );

    await db.notifications.createIndex(
      { recipientId: 1, isRead: 1 },
      { name: 'recipientId_isRead_idx' }
    );

    await db.notifications.createIndex(
      { type: 1 },
      { name: 'type_idx' }
    );

    await db.notifications.createIndex(
      { createdAt: 1 },
      { name: 'createdAt_idx' }
    );

    // TTL index to automatically delete old notifications (optional)
    // Uncomment if you want to automatically delete notifications older than 1 year
    // await db.notifications.createIndex(
    //   { createdAt: 1 },
    //   { 
    //     name: 'ttl_createdAt_idx',
    //     expireAfterSeconds: 365 * 24 * 60 * 60 // 1 year
    //   }
    // );

    console.log('Notifications collection indexes created successfully');

    // Create sample notification for testing (optional)
    if (process.env.NODE_ENV === 'development') {
      const sampleNotification = {
        recipientId: new ObjectId(),
        title: 'Welcome to Shoofi!',
        body: 'هذا إشعار تجريبي لاختبار النظام.',
        type: 'system',
        isRead: false,
        createdAt: new Date(),
        data: {
          action: 'welcome',
          version: '1.0.0'
        },
        deliveryStatus: {
          websocket: 'delivered',
          push: 'pending',
          email: 'pending',
          sms: 'pending'
        }
      };

      await db.notifications.insertOne(sampleNotification);
      console.log('Sample notification created for testing');
    }

    return true;
  } catch (error) {
    console.error('Error creating notifications collection:', error);
    throw error;
  }
}

/**
 * Migration script to update existing users with notification preferences
 */
async function updateUsersWithNotificationPreferences(db) {
  try {
    console.log('Updating users with notification preferences...');

    const result = await db.customers.updateMany(
      { notificationPreferences: { $exists: false } },
      {
        $set: {
          notificationPreferences: {
            push: true,
            email: false,
            sms: false,
            websocket: true
          },
          notificationToken: null,
          lastNotificationCheck: new Date()
        }
      }
    );

    console.log(`Updated ${result.modifiedCount} users with notification preferences`);
    return result.modifiedCount;
  } catch (error) {
    console.error('Error updating users with notification preferences:', error);
    throw error;
  }
}

/**
 * Migration script to create notification templates collection
 */
async function createNotificationTemplatesCollection(db) {
  try {
    console.log('Creating notification templates collection...');

    const collections = await db.listCollections().toArray();
    const templatesExists = collections.some(col => col.name === 'notificationTemplates');

    if (!templatesExists) {
      await db.createCollection('notificationTemplates');
      console.log('Notification templates collection created');
    }

    // Create indexes
    await db.notificationTemplates.createIndex(
      { name: 1 },
      { unique: true, name: 'name_unique_idx' }
    );

    await db.notificationTemplates.createIndex(
      { type: 1 },
      { name: 'type_idx' }
    );

    // Insert default templates
    const defaultTemplates = [
      {
        name: 'new_order',
        type: 'order',
        title: {
          en: 'New Order Received',
          ar: 'طلب جديد',
          he: 'הזמנה חדשה התקבלה'
        },
        body: {
          en: 'You have received a new order #{orderId}',
          ar: 'لقد تلقيت طلب جديد #{orderId}',
          he: 'קיבלת הזמנה חדשה #{orderId}'
        },
        channels: ['websocket', 'push'],
        isActive: true,
        createdAt: new Date()
      },
      {
        name: 'order_status_update',
        type: 'order',
        title: {
          en: 'Order Status Updated',
          ar: 'تم تحديث حالة الطلب',
          he: 'סטטוס ההזמנה עודכן'
        },
        body: {
          en: 'Your order #{orderId} status has been updated to {status}',
          ar: 'تم تحديث حالة طلبك #{orderId} إلى {status}',
          he: 'סטטוס ההזמנה שלך #{orderId} עודכן ל-{status}'
        },
        channels: ['websocket', 'push'],
        isActive: true,
        createdAt: new Date()
      },
      {
        name: 'delivery_assigned',
        type: 'delivery',
        title: {
          en: 'Delivery Driver Assigned',
          ar: 'تم تعيين سائق التوصيل',
          he: 'נהג משלוחים הוקצה'
        },
        body: {
          en: 'A delivery driver has been assigned to your order #{orderId}',
          ar: 'تم تعيين سائق توصيل لطلبك #{orderId}',
          he: 'נהג משלוחים הוקצה להזמנה שלך #{orderId}'
        },
        channels: ['websocket', 'push'],
        isActive: true,
        createdAt: new Date()
      }
    ];

    for (const template of defaultTemplates) {
      await db.notificationTemplates.updateOne(
        { name: template.name },
        { $setOnInsert: template },
        { upsert: true }
      );
    }

    console.log('Default notification templates created');
    return true;
  } catch (error) {
    console.error('Error creating notification templates collection:', error);
    throw error;
  }
}

module.exports = {
  createNotificationsCollection,
  updateUsersWithNotificationPreferences,
  createNotificationTemplatesCollection
}; 