const { MongoClient } = require('mongodb');

// Test script to verify notification creation
async function testNotifications() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('delivery-company');
    
    // Test creating a notification
    const testNotification = {
      recipientId: '507f1f77bcf86cd799439011', // Test driver ID
        title: 'إشعار تجريبي',
  message: 'هذا إشعار تجريبي للتحقق من عمل النظام',
      type: 'test',
      isRead: false,
      createdAt: new Date().toISOString(),
      data: { test: true }
    };
    
    const result = await db.notifications.insertOne(testNotification);
    console.log('Notification created with ID:', result.insertedId);
    
    // Test reading notifications
    const notifications = await db.notifications.find({ recipientId: '507f1f77bcf86cd799439011' }).toArray();
    console.log('Found notifications:', notifications.length);
    
    // Clean up test notification
    await db.notifications.deleteOne({ _id: result.insertedId });
    console.log('Test notification cleaned up');
    
  } catch (error) {
    console.error('Error testing notifications:', error);
  } finally {
    await client.close();
  }
}

// Run the test
testNotifications(); 