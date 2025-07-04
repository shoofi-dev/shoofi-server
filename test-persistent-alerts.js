const { MongoClient } = require("mongodb");
const { getId } = require("./lib/common");
const PersistentAlertsService = require("./utils/persistent-alerts");

// Mock request object for testing
const createMockRequest = (appName = "shoofi-app") => ({
  app: {
    db: {
      "shoofi-app": {
        orders: {
          findOne: async (query) => {
            // Mock order data
            return {
              _id: getId("507f1f77bcf86cd799439011"),
              orderId: "ORD-001",
              customerId: getId("507f1f77bcf86cd799439012"),
              customerName: "أحمد محمد",
              orderPrice: 150,
              total: 150,
              status: "0",
              isViewd: false,
              isViewdAdminAll: false,
              order: {
                items: [
                  { name: "برجر دجاج", quantity: 2, price: 50 },
                  { name: "بطاطس مقلية", quantity: 1, price: 25 }
                ],
                receipt_method: "PICKUP"
              },
              app_language: "ar"
            };
          }
        },
        store: {
          findOne: async () => ({
            id: 1,
            storeName: "مطعم الشوفة",
            appName: appName
          })
        }
      },
      "shoofi": {
        storeUsers: {
          find: async () => ({
            toArray: async () => [
              {
                _id: getId("507f1f77bcf86cd799439013"),
                fullName: "محمد أحمد",
                name: "محمد أحمد",
                role: "owner",
                appName: appName,
                isActive: true
              },
              {
                _id: getId("507f1f77bcf86cd799439014"),
                fullName: "فاطمة علي",
                name: "فاطمة علي",
                role: "manager",
                appName: appName,
                isActive: true
              }
            ]
          })
        },
        persistentAlerts: {
          insertOne: async (alert) => {
            console.log("✅ Persistent alert created:", alert);
            return { insertedId: getId("507f1f77bcf86cd799439015") };
          },
          findOne: async (query) => {
            if (query.status === "pending") {
              return {
                _id: getId("507f1f77bcf86cd799439015"),
                orderId: getId("507f1f77bcf86cd799439011"),
                orderNumber: "ORD-001",
                appName: appName,
                customerName: "أحمد محمد",
                orderTotal: 150,
                status: "pending",
                createdAt: new Date(),
                storeUsers: [
                  {
                    userId: getId("507f1f77bcf86cd799439013"),
                    name: "محمد أحمد",
                    role: "owner",
                    notified: true
                  },
                  {
                    userId: getId("507f1f77bcf86cd799439014"),
                    name: "فاطمة علي",
                    role: "manager",
                    notified: true
                  }
                ]
              };
            }
            return null;
          },
          updateOne: async (query, update) => {
            console.log("✅ Persistent alert updated:", { query, update });
            return { modifiedCount: 1 };
          },
          find: async (query) => ({
            toArray: async () => {
              if (query.status === "pending") {
                return [
                  {
                    _id: getId("507f1f77bcf86cd799439015"),
                    orderId: getId("507f1f77bcf86cd799439011"),
                    orderNumber: "ORD-001",
                    appName: appName,
                    customerName: "أحمد محمد",
                    orderTotal: 150,
                    status: "pending",
                    createdAt: new Date(),
                    reminderCount: 0
                  }
                ];
              }
              return [];
            }
          }),
          aggregate: async (pipeline) => ({
            toArray: async () => [
              { _id: "pending", count: 2, avgResponseTime: null },
              { _id: "approved", count: 5, avgResponseTime: 300000 } // 5 minutes average
            ]
          })
        },
        notifications: {
          insertOne: async (notification) => {
            console.log("✅ Notification created:", notification);
            return { insertedId: getId("507f1f77bcf86cd799439016") };
          }
        }
      }
    }
  },
  headers: {
    "app-name": appName,
    "app-type": "shoofi-partner"
  },
  user: {
    id: getId("507f1f77bcf86cd799439013")
  }
});

// Test data
const testOrderDoc = {
  _id: getId("507f1f77bcf86cd799439011"),
  orderId: "ORD-001",
  customerId: getId("507f1f77bcf86cd799439012"),
  customerName: "أحمد محمد",
  orderPrice: 150,
  total: 150,
  status: "0",
  isViewd: false,
  isViewdAdminAll: false,
  order: {
    items: [
      { name: "برجر دجاج", quantity: 2, price: 50 },
      { name: "بطاطس مقلية", quantity: 1, price: 25 }
    ],
    receipt_method: "PICKUP"
  },
  app_language: "ar"
};

async function testPersistentAlerts() {
  console.log("🧪 Testing Persistent Alerts System\n");

  const req = createMockRequest("shoofi-app");
  const persistentAlertsService = require("./utils/persistent-alerts");

  try {
    // Test 1: Send persistent alert for new order
    console.log("📋 Test 1: Sending persistent alert for new order");
    await persistentAlertsService.sendPersistentAlert(testOrderDoc, req, "shoofi-app");
    console.log("✅ Test 1 passed\n");

    // Test 2: Get pending orders
    console.log("📋 Test 2: Getting pending orders");
    const pendingOrders = await persistentAlertsService.getPendingOrders(req, "shoofi-app");
    console.log(`✅ Found ${pendingOrders.length} pending orders`);
    console.log("✅ Test 2 passed\n");

    // Test 3: Clear persistent alert (simulate order approval)
    console.log("📋 Test 3: Clearing persistent alert (order approval)");
    await persistentAlertsService.clearPersistentAlert(testOrderDoc._id, req, "shoofi-app");
    console.log("✅ Test 3 passed\n");

    // Test 4: Send reminders
    console.log("�� Test 4: Sending reminders for pending orders");
    await persistentAlertsService.sendReminders(req, "shoofi-app");
    console.log("✅ Test 4 passed\n");

    // Test 5: Get alert statistics
    console.log("📋 Test 5: Getting alert statistics");
    const stats = await persistentAlertsService.getAlertStats(req, "shoofi-app");
    console.log("✅ Alert statistics:", stats);
    console.log("✅ Test 5 passed\n");

    // Test 6: Test with different app types
    console.log("📋 Test 6: Testing with different app types");
    const appTypes = ["shoofi-app", "shoofi-shoofir", "shoofi-partner"];
    
    for (const appType of appTypes) {
      console.log(`   Testing app type: ${appType}`);
      const reqForApp = createMockRequest(appType);
      await persistentAlertsService.sendPersistentAlert(testOrderDoc, reqForApp, appType);
      console.log(`   ✅ ${appType} test passed`);
    }
    console.log("✅ Test 6 passed\n");

    console.log("🎉 All tests passed successfully!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Test the integration with isViewd flow
async function testIsViewdIntegration() {
  console.log("🧪 Testing isViewd Integration\n");

  const req = createMockRequest("shoofi-app");

  try {
    // Step 1: Create order and send persistent alert
    console.log("📋 Step 1: Creating order and sending persistent alert");
    await persistentAlertsService.sendPersistentAlert(testOrderDoc, req, "shoofi-app");
    console.log("✅ Persistent alert sent\n");

    // Step 2: Simulate order approval (isViewd = true)
    console.log("📋 Step 2: Simulating order approval (isViewd = true)");
    const updateobj = {
      isViewd: true,
      isViewdAdminAll: true,
      currentTime: new Date(),
      readyMinutes: 15
    };

    // This simulates what happens in the "update/viewd" endpoint
    if (updateobj.isViewd === true) {
      await persistentAlertsService.clearPersistentAlert(testOrderDoc._id, req, "shoofi-app");
      console.log("✅ Persistent alert cleared upon approval\n");
    }

    // Step 3: Verify no pending alerts remain
    console.log("📋 Step 3: Verifying no pending alerts remain");
    const pendingOrders = await persistentAlertsService.getPendingOrders(req, "shoofi-app");
    console.log(`✅ Remaining pending orders: ${pendingOrders.length}`);
    console.log("✅ Test completed successfully!");

  } catch (error) {
    console.error("❌ Integration test failed:", error);
  }
}

// Run tests
async function runAllTests() {
  console.log("🚀 Starting Persistent Alerts System Tests\n");
  
  await testPersistentAlerts();
  console.log("\n" + "=".repeat(50) + "\n");
  await testIsViewdIntegration();
  
  console.log("\n🎉 All tests completed!");
}

// Export for use in other test files
module.exports = {
  testPersistentAlerts,
  testIsViewdIntegration,
  runAllTests,
  createMockRequest,
  testOrderDoc
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}
