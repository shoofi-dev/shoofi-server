const express = require("express");
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');
const notificationService = require("./services/notification/notification-service");
const persistentAlertsService = require("./utils/persistent-alerts");
const { getCustomerAppName } = require("./utils/app-name-helper");
const { getId } = require("./lib/common");
const DatabaseInitializationService = require("./services/database/DatabaseInitializationService");

// Test data for orders
// Note: This test expects existing customers and store users in the database
// Update the customerId and appName to match existing data in your database
const testData = {
  customerId: "6830fd0bef1718effb5b8f3e", // Use existing customer ID from database
  orderDoc: {
    "order": {
      "payment_method": "CASH",
      "receipt_method": "DELIVERY",
      "geo_positioning": {
        "latitude": 32.1524568,
        "longitude": 34.9539749
      },
      "address": {
        "_id": "684d5d1321f7e4537f3a61e5",
        "name": "Test Address",
        "street": "Test Street",
        "city": "Test City",
        "location": {
          "type": "Point",
          "coordinates": [34.9539749, 32.1524568]
        }
      },
      "items": [
        {
          "item_id": "6846f986c6d53455e2c66e9f",
          "name": "Test Product",
          "qty": 1,
          "price": 100
        }
      ]
    },
    "total": 150,
    "app_language": "0",
    "customerId": "6830fd0bef1718effb5b8f3e",
    "orderId": "7837-688740-4643",
    "status": "1",
    "appName": "nnn"
  }
};

// Mock Express app and request object
const mockApp = {
  db: {}
};

const mockReq = {
  app: mockApp,
  headers: {
    "app-name": "nnn",
    "app-type": "shoofi-app"
  },
  ip: "::ffff:192.168.68.51",
  auth: {
    id: "68657025ffc6f39f4ad6b389"
  },
  body: {}
};

// Test function
async function testOrderRoutes() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Setup mock database connections
    console.log('🔧 Initializing databases...');
    
    mockApp.db = {
      nnn: await DatabaseInitializationService.initializeDatabase('nnn', client),
      shoofi: await DatabaseInitializationService.initializeDatabase('shoofi', client),
      'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client)
    };
    
    console.log('✅ Databases initialized successfully');
    
    // Test 1: Setup test data
    console.log('\n🔧 Test 1: Setting up test data...');
    
    // Get existing customer from testData
    const customerDB = getCustomerAppName(mockReq, testData.orderDoc.appName);
    const existingCustomer = await customerDB.customers.findOne({
      _id: getId(testData.customerId)
    });
    
    if (!existingCustomer) {
      console.log('❌ Test customer not found. Please ensure customer exists in database.');
      console.log(`   Customer ID: ${testData.customerId}`);
      console.log(`   App Name: ${testData.orderDoc.appName}`);
      return;
    }
    console.log('✅ Test customer found:', existingCustomer.fullName);
    
    // Get existing store user from testData
    const shoofiDB = mockApp.db['shoofi'];
    const existingStoreUser = await shoofiDB.storeUsers.findOne({
      appName: testData.orderDoc.appName
    });
    
    if (!existingStoreUser) {
      console.log('❌ Store user not found for app. Please ensure store user exists in database.');
      console.log(`   App Name: ${testData.orderDoc.appName}`);
      return;
    }
    console.log('✅ Store user found:', existingStoreUser.fullName);
    
    // Test 2: Test order creation (cash payment)
    console.log('\n📦 Test 2: Testing order creation (cash payment)...');
    
    const orderCreateData = {
      ...testData.orderDoc,
      customerId: testData.customerId,
      orderId: `test-${Date.now()}`,
      status: "6",
      isPrinted: false,
      isViewd: false,
      isViewdAdminAll: false
    };
    
    const db = mockApp.db[testData.orderDoc.appName];
    const newDoc = await db.orders.insertOne(orderCreateData);
    console.log('✅ Order created with ID:', newDoc.insertedId);
    
    // Test persistent alerts for store owners
    console.log('\n🔔 Test 2.1: Testing persistent alerts for store owners...');
    
    try {
      await persistentAlertsService.sendPersistentAlert(orderCreateData, mockReq, testData.orderDoc.appName);
      console.log('✅ Persistent alerts sent to store owners');
    } catch (error) {
      console.error('❌ Failed to send persistent alerts:', error);
    }
    
    // Test 3: Test order update
    console.log('\n👁️ Test 3: Testing order update...');
    
    const order = await db.orders.findOne({});
    if (order) {
      const updateData = {
        isViewd: true,
        isViewdAdminAll: true,
        orderDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        status: "1"
      };
      
      await db.orders.updateOne(
        { _id: order._id },
        { $set: updateData },
        { multi: false }
      );
      
      console.log('✅ Order updated successfully');
      
      // Test persistent alert clearing (simulating order approval)
      console.log('\n🔔 Test 3.1: Testing persistent alert clearing...');
      try {
        await persistentAlertsService.clearPersistentAlert(order._id, mockReq, testData.orderDoc.appName);
        console.log('✅ Persistent alerts cleared successfully');
      } catch (error) {
        console.error('❌ Failed to clear persistent alerts:', error);
      }
      
      // Test customer notification
      await notificationService.sendNotification({
        recipientId: order.customerId,
        title: "تحديث حالة الطلب",
        body: `طلبك رقم #${order.orderId} قيد التحضير الآن`,
        type: 'order_status',
        appName: testData.orderDoc.appName,
        appType: mockReq.headers["app-type"] || 'shoofi-app',
        channels: { websocket: true, push: true, email: false, sms: true },
        data: {
          orderId: order.orderId,
          orderStatus: "1",
          receiptMethod: order.order.receipt_method,
          total: order.total
        },
        req: mockReq
      });
      console.log('✅ Customer notification sent successfully');
    }
    
    // Test 4: Test persistent alerts functionality
    console.log('\n🔔 Test 4: Testing persistent alerts functionality...');
    
    // Test getting pending orders
    try {
      const pendingOrders = await persistentAlertsService.getPendingOrders(mockReq, testData.orderDoc.appName);
      console.log(`✅ Found ${pendingOrders.length} pending orders`);
    } catch (error) {
      console.error('❌ Failed to get pending orders:', error);
    }
    
    // Test getting alert statistics
    try {
      const alertStats = await persistentAlertsService.getAlertStats(mockReq, testData.orderDoc.appName);
      console.log('✅ Alert statistics:', alertStats);
    } catch (error) {
      console.error('❌ Failed to get alert statistics:', error);
    }
    
    // Test 5: Verify notifications
    console.log('\n📋 Test 5: Verifying notifications...');
    
    const notifications = await shoofiDB.notifications
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();
    
    console.log(`✅ Found ${notifications.length} notifications`);
    notifications.forEach((notification, index) => {
      console.log(`  ${index + 1}. ${notification.title}: ${notification.body.substring(0, 50)}...`);
    });
    
    console.log('\n�� All order route tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run tests if called directly
if (require.main === module) {
  console.log('🚀 Starting Order Route Tests...\n');
  testOrderRoutes();
}

module.exports = { testOrderRoutes, testData };
