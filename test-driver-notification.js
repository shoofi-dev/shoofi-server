const { MongoClient, ObjectId } = require('mongodb');
const { getId } = require('./lib/common');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');
const notificationService = require('./services/notification/notification-service');

// Test configuration
const TEST_CONFIG = {
  TEST_CUSTOMER_ID: '507f1f77bcf86cd799439011',
  TEST_ORDER_ID: '507f1f77bcf86cd799439012',
  TEST_DRIVER_ID: '507f1f77bcf86cd799439013',
  TEST_STORE_ID: '507f1f77bcf86cd799439014',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017'
};

let client;
let mockApp;

// Initialize database connection
async function initDatabase() {
  try {
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // Initialize databases
    const databases = {
      'test-app': await DatabaseInitializationService.initializeDatabase('test-app', client),
      'shoofi': await DatabaseInitializationService.initializeDatabase('shoofi', client),
      'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client)
    };

    console.log('✅ All databases initialized');

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
    notificationToken: 'ExponentPushToken[customer-test-token]',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const db = mockApp.db['test-app'];
  await db.customers.insertOne(customerData);
  console.log('  ✅ Customer created');
}

// Create test driver
async function createTestDriver() {
  console.log('🚗 Creating test driver...');
  
  const driverData = {
    _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
    name: 'أحمد محمد',
    phone: '0528602122',
    email: 'ahmed@test.com',
    notificationToken: 'ExponentPushToken[driver-test-token]',
    role: 'driver',
    isActive: true,
    companyId: '507f1f77bcf86cd799439015',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const db = mockApp.db['delivery-company'];
  await db.customers.insertOne(driverData);
  console.log('  ✅ Driver created');
}

// Create test order
async function createTestOrder() {
  console.log('📦 Creating test order...');
  
  const orderData = {
    _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID),
    orderId: 'test-order-12345',
    customerId: TEST_CONFIG.TEST_CUSTOMER_ID,
    appName: 'test-app',
    status: '2', // COMPLETED - ready to be updated to WAITING_FOR_DRIVER
    total: 150,
    order: {
      payment_method: 'CASH',
      receipt_method: 'DELIVERY',
      geo_positioning: {
        latitude: 32.1524568,
        longitude: 34.9539749
      },
      address: {
        _id: '507f1f77bcf86cd799439016',
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
          item_id: '507f1f77bcf86cd799439017',
          name: 'Test Product',
          qty: 1,
          price: 100
        }
      ]
    },
    app_language: '0',
    created: new Date().toISOString()
  };

  const db = mockApp.db['test-app'];
  await db.orders.insertOne(orderData);
  console.log('  ✅ Order created');
}

// Create test delivery record
async function createTestDeliveryRecord() {
  console.log('🚚 Creating test delivery record...');
  
  const deliveryData = {
    bookId: 'test-order-12345', // Same as orderId
    orderId: TEST_CONFIG.TEST_ORDER_ID,
    customerId: TEST_CONFIG.TEST_CUSTOMER_ID,
    appName: 'test-app',
    status: '2', // APPROVED
    driver: {
      _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
      name: 'أحمد محمد',
      phone: '0528602122'
    },
    customerName: 'فاطمة علي',
    customerPhone: '0528602121',
    storeName: 'Test Restaurant',
    price: 150,
    pickupTime: '30',
    isReadyForPickup: false, // Will be updated to true when order status becomes "3"
    created: new Date().toISOString()
  };

  const db = mockApp.db['delivery-company'];
  await db.bookDelivery.insertOne(deliveryData);
  console.log('  ✅ Delivery record created');
}

// Test driver notification when order status becomes "3"
async function testDriverNotification() {
  console.log('\n🧪 Testing driver notification for status "3"...');
  
  try {
    // Update order status to "3" (WAITING_FOR_DRIVER)
    const db = mockApp.db['test-app'];
    await db.orders.updateOne(
      { _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID) },
      { $set: { status: '3' } }
    );
    
    // Get updated order
    const order = await db.orders.findOne({ _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID) });
    console.log(`  ✅ Order status updated to: ${order.status}`);
    
    // Get customer
    const customer = await db.customers.findOne({ _id: new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID) });
    
    // Simulate the driver notification logic from the order update route
    if (order.status === "3" && order.order.receipt_method === "DELIVERY") {
      console.log('  🔍 Checking for delivery record...');
      
      // Find the delivery record for this order
      const deliveryDB = mockApp.db["delivery-company"];
      const deliveryRecord = await deliveryDB.bookDelivery.findOne({
        bookId: order.orderId
      });

             if (deliveryRecord && deliveryRecord.driver?._id) {
         console.log('  ✅ Delivery record found with assigned driver');
         
         // Update delivery record to mark it as ready for pickup
         await deliveryDB.bookDelivery.updateOne(
           { bookId: order.orderId },
           { 
             $set: { 
               isReadyForPickup: true,
               readyForPickupAt: new Date()
             }
           }
         );
         console.log('  ✅ Delivery record updated with isReadyForPickup: true');
         
         // Send notification to the assigned driver
         const notificationResult = await notificationService.sendNotification({
           recipientId: String(deliveryRecord.driver._id),
           title: "طلب جاهز للاستلام",
           body: `طلب رقم #${order.orderId} جاهز للاستلام من المطعم.`,
           type: "order_ready_pickup",
           appName: "delivery-company",
           appType: "shoofi-shoofir",
           channels: {
             websocket: true,
             push: true,
             email: false,
             sms: false
           },
           data: {
             orderId: order._id,
             bookId: order.orderId,
             orderStatus: order.status,
             customerName: customer?.fullName || "العميل",
             customerPhone: customer?.phone || "",
             storeName: order.storeName || "المطعم",
             isReadyForPickup: true
           },
           req: {
             app: mockApp,
             headers: {
               'app-type': 'shoofi-shoofir'
             }
           }
         });
        
        console.log('  ✅ Driver notification sent successfully');
        console.log('  📱 Notification ID:', notificationResult._id);
        
        // Verify notification was created in database
        const notificationDB = mockApp.db['delivery-company'];
        const savedNotification = await notificationDB.notifications.findOne({
          _id: notificationResult._id
        });
        
                 if (savedNotification) {
           console.log('  ✅ Notification saved to database');
           console.log('  📋 Notification details:', {
             title: savedNotification.title,
             body: savedNotification.body,
             type: savedNotification.type,
             recipientId: savedNotification.recipientId
           });
         } else {
           console.log('  ❌ Notification not found in database');
         }
         
         // Verify delivery record was updated
         const updatedDeliveryRecord = await deliveryDB.bookDelivery.findOne({
           bookId: order.orderId
         });
         
         if (updatedDeliveryRecord?.isReadyForPickup) {
           console.log('  ✅ Delivery record updated with isReadyForPickup: true');
           console.log('  📅 Ready for pickup at:', updatedDeliveryRecord.readyForPickupAt);
         } else {
           console.log('  ❌ Delivery record not updated with isReadyForPickup');
         }
        
        return true;
      } else {
        console.log('  ❌ No delivery record found or no driver assigned');
        return false;
      }
    } else {
      console.log('  ❌ Order is not delivery or status is not "3"');
      return false;
    }
  } catch (error) {
    console.error('  ❌ Error testing driver notification:', error);
    return false;
  }
}

// Check notifications in database
async function checkNotifications() {
  console.log('\n📋 Checking notifications in database...');
  
  const notificationDB = mockApp.db['delivery-company'];
  const notifications = await notificationDB.notifications.find({
    recipientId: TEST_CONFIG.TEST_DRIVER_ID
  }).toArray();
  
  console.log(`  📊 Found ${notifications.length} notifications for driver`);
  
  notifications.forEach((notification, index) => {
    console.log(`  ${index + 1}. ${notification.title} - ${notification.body}`);
  });
}

// Cleanup test data
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    // Clean up test-app database
    const testAppDB = mockApp.db['test-app'];
    await testAppDB.customers.deleteOne({ _id: new ObjectId(TEST_CONFIG.TEST_CUSTOMER_ID) });
    await testAppDB.orders.deleteOne({ _id: new ObjectId(TEST_CONFIG.TEST_ORDER_ID) });
    
    // Clean up delivery-company database
    const deliveryDB = mockApp.db['delivery-company'];
    await deliveryDB.customers.deleteOne({ _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID) });
    await deliveryDB.bookDelivery.deleteOne({ bookId: 'test-order-12345' });
    await deliveryDB.notifications.deleteMany({ recipientId: TEST_CONFIG.TEST_DRIVER_ID });
    
    console.log('  ✅ Test data cleaned up');
  } catch (error) {
    console.error('  ❌ Error cleaning up test data:', error);
  }
}

// Main test function
async function testDriverNotificationFunctionality() {
  console.log('🚀 Starting Driver Notification Test\n');
  
  try {
    // Initialize database
    const dbInitialized = await initDatabase();
    if (!dbInitialized) {
      console.error('❌ Failed to initialize database');
      return;
    }
    
    // Create test data
    await createTestCustomer();
    await createTestDriver();
    await createTestOrder();
    await createTestDeliveryRecord();
    
    // Test driver notification
    const testResult = await testDriverNotification();
    
    if (testResult) {
      console.log('\n✅ Driver notification test PASSED');
    } else {
      console.log('\n❌ Driver notification test FAILED');
    }
    
    // Check notifications
    await checkNotifications();
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    // Cleanup
    await cleanupTestData();
    
    // Close database connection
    if (client) {
      await client.close();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDriverNotificationFunctionality()
    .then(() => {
      console.log('\n🎉 Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testDriverNotificationFunctionality,
  initDatabase,
  createTestCustomer,
  createTestDriver,
  createTestOrder,
  createTestDeliveryRecord,
  testDriverNotification,
  cleanupTestData
}; 