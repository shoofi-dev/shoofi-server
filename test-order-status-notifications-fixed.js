const { MongoClient, ObjectId } = require('mongodb');
const { getId } = require('./lib/common');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');
const notificationService = require('./services/notification/notification-service');

// Test configuration with valid ObjectId strings
const TEST_CONFIG = {
  TEST_CUSTOMER_ID: '507f1f77bcf86cd799439011',
  TEST_ORDER_ID: '507f1f77bcf86cd799439012',
  TEST_STORE_ID: '507f1f77bcf86cd799439013',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017'
};

// Test data
const testData = {
  customerId: TEST_CONFIG.TEST_CUSTOMER_ID,
  orderId: TEST_CONFIG.TEST_ORDER_ID,
  storeId: TEST_CONFIG.TEST_STORE_ID,
  orderDoc: {
    _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID),
    orderId: 'test-order-1751629251225',
    customerId: TEST_CONFIG.TEST_CUSTOMER_ID,
    appName: 'test-app',
    status: '6',
    total: 150,
    order: {
      payment_method: 'CASH',
      receipt_method: 'DELIVERY',
      geo_positioning: {
        latitude: 32.1524568,
        longitude: 34.9539749
      },
      address: {
        _id: '507f1f77bcf86cd799439014',
        name: 'Test Address',
        street: 'Test Street',
        city: 'Test City',
        location: {
          type: 'Point',
          coordinates: [34.9539749, 32.1524568]
        }
      },
      items: [
        {
          item_id: '507f1f77bcf86cd799439015',
          name: 'Test Product',
          qty: 1,
          price: 100
        }
      ]
    },
    app_language: '0',
    created: new Date().toISOString()
  }
};

let client;
let mockApp;

// Initialize database connection using DatabaseInitializationService
async function initDatabase() {
  try {
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // Initialize databases using the service
    const databases = {
      'test-app': await DatabaseInitializationService.initializeDatabase('test-app', client),
      'shoofi': await DatabaseInitializationService.initializeDatabase('shoofi', client),
      'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client)
    };

    console.log('✅ All databases initialized using DatabaseInitializationService');

    // Create mock app object
    mockApp = {
      db: databases
    };

    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

// Create test customer
async function createTestCustomer() {
  console.log('👤 Creating test customer...');
  
  const customerData = {
    _id: new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID),
    fullName: 'فاطمة علي',
    phone: '0528602121',
    email: 'fatima@test.com',
    notificationToken: 'ExponentPushToken[customer-status-token-456]',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Insert into multiple databases to test different app types
  const databases = [
    { name: 'shoofi', collection: 'customers' },
    { name: 'test-app', collection: 'customers' }
  ];

  for (const dbInfo of databases) {
    const db = mockApp.db[dbInfo.name];
    if (db) {
      await db[dbInfo.collection].insertOne(customerData);
      console.log(`  ✅ Customer created in ${dbInfo.name}`);
    }
  }
}

// Create test order
async function createTestOrder() {
  console.log('📦 Creating test order...');
  
  const orderData = {
    ...testData.orderDoc,
    _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Insert into the test app database
  const db = mockApp.db['test-app'];
  if (db) {
    await db.orders.insertOne(orderData);
    console.log('  ✅ Order created in test-app');
  }
}

// Create test store
async function createTestStore() {
  console.log('🏪 Creating test store...');
  
  const storeData = {
    _id: new ObjectId(TEST_CONFIG.TEST_STORE_ID),
    storeName: 'Test Restaurant',
    appName: 'test-app',
    order_company_number: '0542454362',
    order_company_delta_minutes: 30,
    location: {
      type: 'Point',
      coordinates: [34.756, 32.056]
    },
    coverageRadius: 5000,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const db = mockApp.db['test-app'];
  if (db) {
    await db.store.insertOne(storeData);
    console.log('  ✅ Store created in test-app');
  }
}

// Simulate order status update and notification
async function simulateOrderStatusUpdate(status, receiptMethod = 'DELIVERY') {
  console.log(`\n🔄 Simulating order status update to: ${status}`);
  
  // Update order with new status
  const db = mockApp.db['test-app'];
  const updateData = { status: status };
  
  if (receiptMethod === 'TAKEAWAY') {
    updateData['order.receipt_method'] = 'TAKEAWAY';
  }
  
  await db.orders.updateOne(
    { _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID) },
    { $set: updateData }
  );
  
  // Get updated order
  const order = await db.orders.findOne({ _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID) });
  
  // Get customer
  const customer = await db.customers.findOne({ _id: new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID) });
  
  if (!customer) {
    console.log('  ❌ Customer not found');
    return false;
  }
  
  // Simulate the notification logic from the order update route
  try {
    let notificationTitle = "";
    let notificationBody = "";
    let notificationType = "order";
    
    switch (status) {
      case "1": // IN_PROGRESS
        notificationTitle = "طلبك قيد التحضير";
        notificationBody = `طلبك رقم #${order.orderId} قيد التحضير الآن.`;
        break;
      case "2": // COMPLETED
        if (order.order.receipt_method === "TAKEAWAY") {
          notificationTitle = "طلبك جاهز للاستلام";
          notificationBody = `طلبك رقم #${order.orderId} جاهز للاستلام من المطعم.`;
        } else {
          notificationTitle = "طلبك جاهز للتوصيل";
          notificationBody = `طلبك رقم #${order.orderId} تم تحضيره وهو جاهز للتوصيل.`;
        }
        break;
      case "3": // WAITING_FOR_DRIVER
        notificationTitle = "في انتظار السائق";
        notificationBody = `طلبك رقم #${order.orderId} جاهز وتم إرساله للسائق.`;
        break;
      case "4": // CANCELLED
        notificationTitle = "تم إلغاء طلبك";
        notificationBody = `طلبك رقم #${order.orderId} تم إلغاؤه. إذا كان لديك أي استفسار، يرجى التواصل معنا.`;
        notificationType = "order_cancelled";
        break;
      case "5": // REJECTED
        notificationTitle = "تم رفض طلبك";
        notificationBody = `عذراً، تم رفض طلبك رقم #${order.orderId}. يرجى التواصل معنا للمزيد من المعلومات.`;
        notificationType = "order_rejected";
        break;
      case "6": // PENDING
        notificationTitle = "تم استلام طلبك";
        notificationBody = `طلبك رقم #${order.orderId} تم استلامه وهو قيد المراجعة.`;
        break;
      case "7": // CANCELLED_BY_ADMIN
        notificationTitle = "تم إلغاء طلبك من قبل الإدارة";
        notificationBody = `طلبك رقم #${order.orderId} تم إلغاؤه من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات.`;
        notificationType = "order_cancelled_admin";
        break;
      case "8": // CANCELLED_BY_CUSTOMER
        notificationTitle = "تم إلغاء طلبك";
        notificationBody = `طلبك رقم #${order.orderId} تم إلغاؤه بنجاح.`;
        notificationType = "order_cancelled_customer";
        break;
      case "9": // CANCELLED_BY_DRIVER
        notificationTitle = "تم إلغاء الطلب من قبل السائق";
        notificationBody = `طلبك رقم #${order.orderId} تم إلغاؤه من قبل السائق. سيتم إعادة تعيين سائق جديد.`;
        notificationType = "order_cancelled_driver";
        break;
      case "10": // PICKED_UP
        notificationTitle = "تم استلام طلبك";
        notificationBody = `طلبك رقم #${order.orderId} تم استلامه من المطعم.`;
        break;
      case "11": // PICKED_UP_BY_DRIVER
        notificationTitle = "تم استلام الطلب من قبل السائق";
        notificationBody = `طلبك رقم #${order.orderId} تم استلامه من قبل السائق وهو في الطريق إليك.`;
        break;
      case "12": // DELIVERED
        notificationTitle = "تم تسليم طلبك";
        notificationBody = `طلبك رقم #${order.orderId} تم تسليمه بنجاح. نتمنى لك وجبة شهية!`;
        notificationType = "delivery_complete";
        break;
      default:
        notificationTitle = "تحديث حالة الطلب";
        notificationBody = `تم تحديث حالة طلبك رقم #${order.orderId}.`;
    }
    
    if (notificationTitle && notificationBody) {
      // Create mock request object
      const mockReq = {
        app: {
          db: mockApp.db
        },
        headers: {
          'app-name': 'test-app',
          'app-type': 'shoofi-app'
        }
      };
      
      await notificationService.sendNotification({
        recipientId: order.customerId,
        title: notificationTitle,
        body: notificationBody,
        type: notificationType,
        appName: order.appName,
        appType: 'shoofi-app',
        channels: {
          websocket: true,
          push: true,
          email: false,
          sms: false
        },
        data: {
          orderId: order.orderId,
          orderStatus: status,
          receiptMethod: order.order.receipt_method,
          total: order.total,
          customerName: customer.fullName
        },
        req: mockReq
      });
      
      console.log(`  ✅ Notification sent: ${notificationTitle}`);
      console.log(`     Body: ${notificationBody}`);
      console.log(`     Type: ${notificationType}`);
      return true;
    }
  } catch (error) {
    console.log(`  ❌ Notification failed:`, error.message);
    return false;
  }
}

// Check notifications in database
async function checkNotifications() {
  console.log('\n📋 Checking notifications in database...');
  
  const db = mockApp.db['test-app'];
  if (db) {
    const notifications = await db.notifications
      .find({ recipientId: TEST_CONFIG.TEST_CUSTOMER_ID })
      .sort({ createdAt: -1 })
      .toArray();
    
    console.log(`  ✅ Found ${notifications.length} notifications`);
    notifications.forEach((notification, index) => {
      console.log(`    ${index + 1}. ${notification.title}: ${notification.body.substring(0, 50)}...`);
      console.log(`       Type: ${notification.type}, Status: ${notification.data?.orderStatus}`);
    });
  }
}

// Cleanup test data
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  const databases = [
    { name: 'shoofi', collections: ['customers', 'notifications'] },
    { name: 'test-app', collections: ['customers', 'orders', 'store', 'notifications'] }
  ];

  for (const dbInfo of databases) {
    const db = mockApp.db[dbInfo.name];
    if (db) {
      for (const collection of dbInfo.collections) {
        try {
          await db[collection].deleteMany({
            _id: { $in: [
              new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID),
              new ObjectId(TEST_CONFIG.TEST_ORDER_ID),
              new ObjectId(TEST_CONFIG.TEST_STORE_ID)
            ]}
          });
          console.log(`  ✅ Cleaned ${collection} in ${dbInfo.name}`);
        } catch (error) {
          console.log(`  ⚠️ Could not clean ${collection} in ${dbInfo.name}:`, error.message);
        }
      }
    }
  }
}

// Main test function
async function testOrderStatusNotifications() {
  try {
    console.log('🚀 Starting Order Status Notification Tests...\n');
    
    // Initialize database
    const dbInitialized = await initDatabase();
    if (!dbInitialized) {
      throw new Error('Database initialization failed');
    }
    
    // Create test data
    await createTestCustomer();
    await createTestStore();
    await createTestOrder();
    
    // Test different order statuses
    const statusTests = [
      { status: '1', description: 'Order In Progress' },
      { status: '2', description: 'Order Completed (Delivery)', receiptMethod: 'DELIVERY' },
      { status: '2', description: 'Order Completed (Takeaway)', receiptMethod: 'TAKEAWAY' },
      { status: '3', description: 'Waiting For Driver' },
      { status: '4', description: 'Order Cancelled' },
      { status: '5', description: 'Order Rejected' },
      { status: '6', description: 'Order Pending' },
      { status: '7', description: 'Order Cancelled By Admin' },
      { status: '8', description: 'Order Cancelled By Customer' },
      { status: '9', description: 'Order Cancelled By Driver' },
      { status: '10', description: 'Order Picked Up' },
      { status: '11', description: 'Order Picked Up By Driver' },
      { status: '12', description: 'Order Delivered' }
    ];
    
    console.log('\n📊 Testing all order status notifications...');
    
    for (const test of statusTests) {
      console.log(`\n--- Testing: ${test.description} ---`);
      const success = await simulateOrderStatusUpdate(test.status, test.receiptMethod);
      if (success) {
        console.log(`✅ ${test.description} notification sent successfully`);
      } else {
        console.log(`❌ ${test.description} notification failed`);
      }
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Check all notifications
    await checkNotifications();
    
    console.log('\n🎉 All order status notification tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error stack:', error.stack);
  } finally {
    // Cleanup
    await cleanupTestData();
    if (client) {
      await client.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Check if running directly
if (require.main === module) {
  testOrderStatusNotifications();
}

module.exports = { testOrderStatusNotifications, testData }; 