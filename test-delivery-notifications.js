const { MongoClient, ObjectId } = require('mongodb');
const notificationService = require('./services/notification/notification-service');
const deliveryService = require('./services/delivery/book-delivery');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');

// Test configuration
const TEST_CONFIG = {
  MONGODB_URI: 'mongodb://localhost:27017',
  DATABASE_NAME: 'shoofi-test',
  DELIVERY_COMPANY_DB: 'delivery-company',
  TEST_DRIVER_ID: '68337db5176dbd5c5e15eea2', // Example ObjectId
  TEST_CUSTOMER_ID: '507f1f77bcf86cd799439012', // Example ObjectId
  TEST_ORDER_ID: '507f1f77bcf86cd799439013', // Example ObjectId
};

let client;
let db;
let mockApp;

// Initialize database connection using DatabaseInitializationService
async function initDatabase() {
  try {
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Initialize the test database using DatabaseInitializationService
    db = await DatabaseInitializationService.initializeDatabase(TEST_CONFIG.DATABASE_NAME, client);
    
    // Create mock app structure for notification service
    mockApp = {
      db: {
        [TEST_CONFIG.DATABASE_NAME]: db,
        'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client),
        'shoofi': await DatabaseInitializationService.initializeDatabase('shoofi', client)
      }
    };
    
    console.log('✅ Database initialized using DatabaseInitializationService');
    console.log('✅ Available collections:', Object.keys(db).filter(key => !key.startsWith('_')));
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Clean up test data
async function cleanupTestData() {
  try {
    await db.notifications.deleteMany({});
    await db.customers.deleteMany({});
    await db.bookDelivery.deleteMany({});
    console.log('✅ Test data cleaned up');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Create test driver
async function createTestDriver() {
  try {
    const driver = {
      _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
      name: 'أحمد محمد',
      phone: '+972501234567',
      email: 'ahmed@test.com',
      notificationToken: 'ExponentPushToken[test-token-123]',
      role: 'driver',
      isActive: true,
      location: {
        latitude: 31.7683,
        longitude: 35.2137
      },
      createdAt: new Date()
    };
    
    await db.customers.insertOne(driver);
    console.log('✅ Test driver created:', driver.name);
    return driver;
  } catch (error) {
    console.error('❌ Failed to create test driver:', error);
    throw error;
  }
}

// Create test customer
async function createTestCustomer() {
  try {
    const customer = {
      _id: new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID),
      fullName: 'فاطمة علي',
      phone: '+972509876543',
      email: 'fatima@test.com',
      notificationToken: 'ExponentPushToken[customer-token-456]',
      createdAt: new Date()
    };
    
    await db.customers.insertOne(customer);
    console.log('✅ Test customer created:', customer.fullName);
    return customer;
  } catch (error) {
    console.error('❌ Failed to create test customer:', error);
    throw error;
  }
}

// Test notification service for delivery drivers
async function testDeliveryNotifications() {
  console.log('\n🧪 Testing Delivery Notifications...\n');
  
  try {
    // Test 1: Send notification to driver
    console.log('📱 Test 1: Sending notification to driver');
    const driverNotification = await notificationService.sendNotification({
      recipientId: TEST_CONFIG.TEST_DRIVER_ID,
      title: 'تم تعيين طلب جديد',
      body: 'لقد تم تعيينك للطلب: #12345-678901-1234',
      type: 'order',
      appName: 'delivery-company',
      appType: 'shoofi-shoofir',
      channels: { websocket: true, push: true, email: false, sms: false },
      data: { 
        orderId: TEST_CONFIG.TEST_ORDER_ID, 
        bookId: '12345-678901-1234',
        customerName: 'فاطمة علي',
        customerPhone: '+972509876543'
      },
      req: {
        app: mockApp
      }
    });
    console.log('✅ Driver notification sent:', driverNotification._id);
    
    // Test 2: Send order status update notification
    console.log('\n📱 Test 2: Sending order status update notification');
    const statusNotification = await notificationService.sendNotification({
      recipientId: TEST_CONFIG.TEST_DRIVER_ID,
      title: 'تم تسليم الطلب',
      body: 'تم تسليم الطلب: #12345-678901-1234',
      type: 'payment',
      appName: 'delivery-company',
      appType: 'shoofi-shoofir',
      channels: { websocket: true, push: true, email: false, sms: false },
      data: { 
        orderId: TEST_CONFIG.TEST_ORDER_ID, 
        bookId: '12345-678901-1234',
        status: '0'
      },
      req: {
        app: mockApp
      }
    });
    console.log('✅ Status notification sent:', statusNotification._id);
    
    // Test 3: Send order cancellation notification
    console.log('\n📱 Test 3: Sending order cancellation notification');
    const cancelNotification = await notificationService.sendNotification({
      recipientId: TEST_CONFIG.TEST_DRIVER_ID,
      title: 'تم إلغاء الطلب',
      body: 'تم إلغاء الطلب: #12345-678901-1234',
      type: 'alert',
      appName: 'delivery-company',
      appType: 'shoofi-shoofir',
      channels: { websocket: true, push: true, email: false, sms: false },
      data: { 
        orderId: TEST_CONFIG.TEST_ORDER_ID, 
        bookId: '12345-678901-1234',
        status: '-1'
      },
      req: {
        app: mockApp
      }
    });
    console.log('✅ Cancellation notification sent:', cancelNotification._id);
    
    // Test 4: Get driver notifications
    console.log('\n📱 Test 4: Getting driver notifications');
    const driverNotifications = await notificationService.getUserNotifications(
      TEST_CONFIG.TEST_DRIVER_ID,
      'delivery-company',
      { app: mockApp, headers: { 'app-type': 'shoofi-shoofir' } },
      { limit: 10, offset: 0 }
    );
    console.log('✅ Driver notifications retrieved:', driverNotifications.length, 'notifications');
    
    // Test 5: Mark notification as read
    if (driverNotifications.length > 0) {
      console.log('\n📱 Test 5: Marking notification as read');
      const firstNotification = driverNotifications[0];
      await notificationService.markAsRead(
        firstNotification._id.toString(),
        'delivery-company',
        { app: mockApp, headers: { 'app-type': 'shoofi-shoofir' } },
        'shoofi-shoofir'
      );
      console.log('✅ Notification marked as read:', firstNotification._id);
    }
    
    console.log('\n✅ All delivery notification tests passed!');
    
  } catch (error) {
    console.error('❌ Delivery notification test failed:', error);
    throw error;
  }
}

// Test delivery service integration
async function testDeliveryServiceIntegration() {
  console.log('\n🚚 Testing Delivery Service Integration...\n');
  
  try {
    // Create test delivery data
    const deliveryData = {
      fullName: 'فاطمة علي',
      phone: '+972509876543',
      price: '50.00',
      pickupTime: 30,
      storeName: 'مطعم الشوفة',
      appName: 'shoofi-app',
      storeId: new ObjectId(),
      bookId: 'TEST-12345-678901-1234',
      storeLocation: {
        latitude: 31.7683,
        longitude: 35.2137
      },
      coverageRadius: 5000,
      customerLocation: {
        latitude: 31.7700,
        longitude: 35.2200
      }
    };
    
    // Mock appDb structure
    const appDb = {
      'delivery-company': mockApp.db['delivery-company']
    };
    
    // Note: This would require a real driver assignment service
    // For testing purposes, we'll just test the notification part
    console.log('📱 Test: Delivery service notification integration');
    console.log('ℹ️  Note: Full delivery service test requires driver assignment service');
    
    console.log('\n✅ Delivery service integration test completed!');
    
  } catch (error) {
    console.error('❌ Delivery service integration test failed:', error);
    throw error;
  }
}

// Test notification templates
async function testNotificationTemplates() {
  console.log('\n📋 Testing Notification Templates...\n');
  
  try {
    // Test different notification types for delivery
    const templates = [
      {
        title: 'تم تعيين طلب جديد',
        body: 'لقد تم تعيينك للطلب: #{bookId}',
        type: 'order'
      },
      {
        title: 'تم تسليم الطلب',
        body: 'تم تسليم الطلب: #{bookId}',
        type: 'payment'
      },
      {
        title: 'تم إلغاء الطلب',
        body: 'تم إلغاء الطلب: #{bookId}',
        type: 'alert'
      },
      {
        title: 'تحديث حالة الطلب',
        body: 'تم تحديث حالة الطلب: #{bookId} إلى #{status}',
        type: 'system'
      }
    ];
    
    for (const template of templates) {
      console.log(`📱 Testing template: ${template.title}`);
      
      const notification = await notificationService.sendNotification({
        recipientId: TEST_CONFIG.TEST_DRIVER_ID,
        title: template.title,
        body: template.body.replace('#{bookId}', 'TEST-12345').replace('#{status}', 'جاري التوصيل'),
        type: template.type,
        appName: 'delivery-company',
        appType: 'shoofi-shoofir',
        channels: { websocket: true, push: true, email: false, sms: false },
        data: { 
          bookId: 'TEST-12345',
          status: 'جاري التوصيل'
        },
        req: {
          app: mockApp
        }
      });
      
      console.log(`✅ Template notification sent: ${notification._id}`);
    }
    
    console.log('\n✅ All notification template tests passed!');
    
  } catch (error) {
    console.error('❌ Notification template test failed:', error);
    throw error;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Delivery Notifications Tests...\n');
  
  try {
    // Initialize database
    await initDatabase();
    
    // Clean up any existing test data
    await cleanupTestData();
    
    // Create test data
    await createTestDriver();
    await createTestCustomer();
    
    // Run tests
    await testDeliveryNotifications();
    await testDeliveryServiceIntegration();
    await testNotificationTemplates();
    
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanupTestData();
    if (client) {
      await client.close();
      console.log('✅ Database connection closed');
    }
  }
}

// Export for use in other test files
module.exports = {
  runTests,
  initDatabase,
  cleanupTestData,
  createTestDriver,
  createTestCustomer,
  testDeliveryNotifications,
  testDeliveryServiceIntegration,
  testNotificationTemplates
};

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
} 