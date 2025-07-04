const express = require("express");
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');
const notificationService = require("./services/notification/notification-service");
const { getCustomerAppName } = require("./utils/app-name-helper");
const { getId } = require("./lib/common");
const DatabaseInitializationService = require("./services/database/DatabaseInitializationService");

// Test data provided by user
const testData = {
  customerId: "68657025ffc6f39f4ad6b389",
  orderDoc: {
    "_id": {
      "$oid": "68656b6e13b55639eff6bf11"
    },
    "order": {
      "payment_method": "CASH",
      "receipt_method": "DELIVERY",
      "geo_positioning": {
        "latitude": 32.1524568,
        "longitude": 34.9539749,
        "qrURI": "data:image/png;base64,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"
      },
      "address": {
        "_id": "684d5d1321f7e4537f3a61e5",
        "name": "جلجولية",
        "street": "جلجوليا",
        "city": "جلجوليا",
        "cityId": null,
        "location": {
          "type": "Point",
          "coordinates": [
            34.9539749,
            32.1524568
          ]
        },
        "floorNumber": "",
        "streetNumber": "",
        "selectedCity": null,
        "notes": null,
        "isDefault": false,
        "createdAt": "2025-06-14T11:29:23.333Z",
        "updatedAt": "2025-06-14T11:29:29.214Z"
      },
      "items": [
        {
          "item_id": "6846f986c6d53455e2c66e9f",
          "name": "p1",
          "nameAR": "p1",
          "nameHE": "p1",
          "qty": 1,
          "note": "",
          "price": 100,
          "selectedExtras": {
            "95z18o4p8": {
              "3gk8gngc8": {
                "areaId": "full",
                "isFree": true
              }
            },
            "39cct2z8q": {
              "4zmthtrqe": {
                "areaId": "half1",
                "isFree": true
              }
            },
            "eygxncr4p": {
              "lgeqx3a5g": {
                "areaId": "half1",
                "isFree": false
              }
            },
            "4kzbx0nxl": "afl1quma5",
            "8jlufna9y": 300,
            "2o2ngjr9c": [
              "37umotq1c"
            ]
          },
          "img": [
            {
              "uri": "nnn/stores/nnn/products/1749763345971image-1.png"
            }
          ]
        }
      ]
    },
    "total": 150,
    "app_language": "0",
    "device_os": "iOS",
    "app_version": "1.0.0",
    "unique_hash": "c9a38b56a1005122f6cad829cc949ce28d6adace",
    "datetime": "2025-07-04T20:25:00+03:00",
    "orderDate": "2025-07-04T21:23:29+03:00",
    "orderType": null,
    "shippingPrice": 20,
    "orderPrice": 130,
    "isAdmin": false,
    "storeData": {
      "storeId": 1,
      "storeLogo": "shoofi/stores/nnn/logo/1749672240176ChatGPT Image Jun 7, 2025, 05_21_42 PM.png",
      "location": {
        "lat": 32.1144579985367,
        "lng": 34.96952533721924
      },
      "phone": "",
      "cover_sliders": [
        "shoofi/stores/nnn/cover_sliders/1749670994264AramtecDay4-6645_249e6ad5-fb72-4ec9-8f91-8716703d097e.webp",
        "shoofi/stores/nnn/cover_sliders/1749671246438573_15052022085837.jpg"
      ],
      "name_ar": "nnn",
      "name_he": "nnn",
      "maxReady": 50,
      "minReady": 30
    },
    "created": "2025-07-04T14:00:02+03:00",
    "customerId": "6830fd0bef1718effb5b8f3e",
    "orderId": "7837-688740-4643",
    "status": "1",
    "isPrinted": true,
    "isViewd": true,
    "isViewdAdminAll": true,
    "ipAddress": "::ffff:192.168.68.51",
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
    "app-type": "shoofi-app" // Default app type, can be overridden
  },
  ip: "::ffff:192.168.68.51"
};

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

// Test function
async function testOrderNotifications() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Setup mock database connections with proper initialization
    console.log('🔧 Initializing databases...');
    
    try {
      mockApp.db = {
        nnn: await DatabaseInitializationService.initializeDatabase('nnn', client),
        shoofi: await DatabaseInitializationService.initializeDatabase('shoofi', client),
        'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client)
      };
      
      console.log('✅ Databases initialized successfully');
      console.log('  - Available databases:', Object.keys(mockApp.db));
      console.log('  - nnn collections:', Object.keys(mockApp.db.nnn).filter(key => !key.startsWith('_')));
      console.log('  - shoofi collections:', Object.keys(mockApp.db.shoofi).filter(key => !key.startsWith('_')));
      console.log('  - delivery-company collections:', Object.keys(mockApp.db['delivery-company']).filter(key => !key.startsWith('_')));
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
    
    // Test 1: Check if customer exists using app type logic
    console.log('\n🔍 Test 1: Checking if customer exists using app type logic...');
    
    const testPhone = "+972501234567";
    // const appTypes = ['shoofi-app', 'shoofi-shoofir', 'shoofi-partner'];
    const appTypes = ['shoofi-partner'];
    
    for (const appType of appTypes) {
      console.log(`\n  Testing app type: ${appType}`);
      mockReq.headers["app-type"] = appType;
      
      const { customer, customerDB, collection } = await getCustomerByAppType(mockReq, testData.customerId, appType);
      
      console.log(`    🔍 Looking for customer in ${collection} collection of ${customerDB.databaseName || 'unknown'} database`);
      
      if (!customer) {
        console.log(`    ❌ Customer not found in ${collection}. Creating test customer...`);
        
        // Create a test customer based on app type
        const testCustomer = {
          _id: getId(testData.customerId),
          fullName: `Test Customer (${appType})`,
          phone: testPhone,
          email: "test@example.com",
          notificationToken: "ExponentPushToken[test-token-123]",
          orders: []
        };
        
        try {
          await customerDB[collection].insertOne(testCustomer);
          console.log(`    ✅ Test customer created in ${collection}`);
        } catch (insertError) {
          console.log(`    ❌ Failed to create test customer in ${collection}:`, insertError.message);
        }
      } else {
        console.log(`    ✅ Customer found in ${collection}:`, customer.fullName);
      }
    }
    
    // Test 2: Test notification service directly for each app type
    console.log('\n🔔 Test 2: Testing notification service for each app type...');
    
    for (const appType of appTypes) {
      console.log(`\n  Testing notifications for app type: ${appType}`);
      mockReq.headers["app-type"] = appType;
      
              try {
          const notificationResult = await notificationService.sendNotification({
            recipientId: testData.customerId,
                    title: "تم استلام طلبك",
        body: `طلبك رقم #${testData.orderDoc.orderId} تم استلامه وهو قيد المعالجة.`,
            type: 'order',
            appName: testData.orderDoc.appName,
            appType: appType,
            channels: {
              websocket: true,
              push: true,
              email: false,
              sms: true
            },
            data: {
              orderId: testData.orderDoc.orderId,
              orderStatus: testData.orderDoc.status,
              receiptMethod: testData.orderDoc.order.receipt_method,
              total: testData.orderDoc.total,
              appType: appType
            },
            req: mockReq
          });
        
        console.log(`    ✅ Notification sent successfully for ${appType}:`, notificationResult._id);
      } catch (error) {
        console.log(`    ❌ Notification service error for ${appType}:`, error.message);
      }
    }
    
    // Test 3: Test the sendOrderNotifications logic manually
    console.log('\n📦 Test 3: Testing sendOrderNotifications logic manually...');
    
    try {
      // Update the orderDoc with the correct customerId
      const orderDocWithCorrectCustomerId = {
        ...testData.orderDoc,
        customerId: testData.customerId
      };
      
      // Simulate the sendOrderNotifications logic for each app type
      for (const appType of appTypes) {
        console.log(`\n  Testing sendOrderNotifications logic for app type: ${appType}`);
        mockReq.headers["app-type"] = appType;
        
        // Get customer using the same logic as sendOrderNotifications
        const { customer, customerDB, collection } = await getCustomerByAppType(mockReq, testData.customerId, appType);
        
        if (!customer) {
          console.log(`    ❌ Customer not found for ${appType} in ${collection}`);
          continue;
        }
        
        console.log(`    ✅ Customer found for ${appType}:`, customer.fullName);
        
        // Send notification using the same logic as sendOrderNotifications
            const notificationTitle = "تم استلام طلبك";
    const notificationBody = `طلبك رقم #${orderDocWithCorrectCustomerId.orderId} تم استلامه وهو قيد المعالجة.`;
        
        await notificationService.sendNotification({
          recipientId: orderDocWithCorrectCustomerId.customerId,
          title: notificationTitle,
          body: notificationBody,
          type: 'order',
          appName: orderDocWithCorrectCustomerId.appName,
          appType: appType,
          channels: {
            websocket: true,
            push: true,
            email: false,
            sms: true
          },
          data: {
            orderId: orderDocWithCorrectCustomerId.orderId,
            orderStatus: orderDocWithCorrectCustomerId.status,
            receiptMethod: orderDocWithCorrectCustomerId.order.receipt_method,
            total: orderDocWithCorrectCustomerId.total
          },
          req: mockReq
        });
        
        console.log(`    ✅ sendOrderNotifications logic executed successfully for ${appType}`);
      }
    } catch (error) {
      console.log('❌ sendOrderNotifications logic error:', error.message);
      console.log('Error stack:', error.stack);
    }
    
    // Test 4: Check notifications in all relevant databases
    console.log('\n📋 Test 4: Checking notifications in all databases...');
    
    const databasesToCheck = [
      { name: 'shoofi', collection: 'notifications' },
      { name: 'delivery-company', collection: 'notifications' }
    ];
    
    for (const dbInfo of databasesToCheck) {
      console.log(`\n  Checking ${dbInfo.name} database...`);
      const db = mockApp.db[dbInfo.name];
      
      if (db) {
        const notifications = await db[dbInfo.collection]
          .find({ recipientId: getId(testData.customerId) })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();
        
        console.log(`    ✅ Found ${notifications.length} notifications in ${dbInfo.name}`);
        notifications.forEach((notification, index) => {
          console.log(`      ${index + 1}. ${notification.title}: ${notification.body.substring(0, 50)}...`);
        });
      } else {
        console.log(`    ⚠️ Database ${dbInfo.name} not available`);
      }
    }
    
    // Test 5: Test different notification types for each app type
    console.log('\n🎯 Test 5: Testing different notification types for each app type...');
    
    const notificationTypes = [
      {
        title: "تحديث حالة الطلب",
        body: "طلبك قيد التحضير الآن",
        type: "order_status",
        data: { orderId: testData.orderDoc.orderId, status: "preparing" }
      },
      {
        title: "الطلب جاهز",
        body: "طلبك جاهز للاستلام/التوصيل",
        type: "order_ready",
        data: { orderId: testData.orderDoc.orderId, status: "ready" }
      }
    ];
    
    for (const appType of appTypes) {
      console.log(`\n  Testing notification types for app type: ${appType}`);
      mockReq.headers["app-type"] = appType;
      
      for (const notification of notificationTypes) {
        try {
          await notificationService.sendNotification({
            recipientId: testData.customerId,
            title: notification.title,
            body: notification.body,
            type: notification.type,
            appName: testData.orderDoc.appName,
            appType: appType,
            channels: { websocket: true, push: true, email: false, sms: false },
            data: { ...notification.data, appType: appType },
            req: mockReq
          });
          console.log(`    ✅ ${notification.type} notification sent for ${appType}`);
        } catch (error) {
          console.log(`    ❌ ${notification.type} notification failed for ${appType}:`, error.message);
        }
      }
    }

    // Test 6: Test store owner notifications
    console.log('\n🏪 Test 6: Testing store owner notifications...');
    
    try {
      // Create a test store user if it doesn't exist
      const shoofiDB = mockApp.db['shoofi'];
      const existingStoreUser = await shoofiDB.storeUsers.findOne({
        appName: testData.orderDoc.appName
      });
      
      if (!existingStoreUser) {
        console.log('  Creating test store user...');
        const testStoreUser = {
          _id: getId('test-store-user-id'),
          fullName: 'Test Store Owner',
          email: 'store@example.com',
          phone: '+972501234568',
          appName: testData.orderDoc.appName,
          isActive: true,
          notificationToken: 'ExponentPushToken[store-token-123]'
        };
        
        await shoofiDB.storeUsers.insertOne(testStoreUser);
        console.log('  ✅ Test store user created');
      } else {
        console.log('  ✅ Test store user found:', existingStoreUser.fullName);
      }
      
      // Test store owner notification
      await notificationService.sendNotification({
        recipientId: existingStoreUser?._id.toString() || 'test-store-user-id',
        title: "طلب جديد تم استلامه",
        body: `طلب جديد رقم #${testData.orderDoc.orderId} بمبلغ ${testData.orderDoc.total}₪`,
        type: 'order_store_owner',
        appName: testData.orderDoc.appName,
        appType: 'shoofi-partner',
        channels: {
          websocket: true,
          push: true,
          email: false,
          sms: false
        },
        data: {
          orderId: testData.orderDoc.orderId,
          orderStatus: testData.orderDoc.status,
          receiptMethod: testData.orderDoc.order.receipt_method,
          total: testData.orderDoc.total,
          customerName: 'Test Customer',
          appName: testData.orderDoc.appName
        },
        req: mockReq
      });
      
      console.log('  ✅ Store owner notification sent successfully');
    } catch (error) {
      console.log('  ❌ Store owner notification failed:', error.message);
    }
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Check if running directly
if (require.main === module) {
  console.log('🚀 Starting Order Notification Tests...\n');
  testOrderNotifications();
}

module.exports = { testOrderNotifications, testData }; 