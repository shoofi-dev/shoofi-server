const request = require('supertest');
const { MongoClient, ObjectId } = require('mongodb');
const DatabaseInitializationService = require('./services/database/database-initialization-service');

// Test configuration
const TEST_CONFIG = {
  MONGODB_URI: 'mongodb://localhost:27017',
  TEST_DB_NAME: 'shoofi_test_delivery_notifications',
  DELIVERY_DB_NAME: 'delivery-company',
  APP_DB_NAME: 'shoofi-app'
};

// Test data
const TEST_DATA = {
  customer: {
    _id: new ObjectId(),
    phone: '+972501234567',
    fullName: 'Test Customer',
    email: 'customer@test.com',
    role: 'customer',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  driver: {
    _id: new ObjectId(),
    phone: '+972507654321',
    fullName: 'Test Driver',
    email: 'driver@test.com',
    role: 'driver',
    companyId: 'test-company',
    isActive: true,
    isOnline: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  deliveryOrder: {
    _id: new ObjectId(),
    bookId: 'TEST-DELIVERY-001',
    customerId: null, // Will be set to customer._id
    customerLocation: {
      latitude: 32.0853,
      longitude: 34.7818,
      address: 'Test Address, Tel Aviv'
    },
    driver: null, // Will be set to driver info
    status: '1', // WAITING_FOR_APPROVE
    price: 25.00,
    appName: 'shoofi-app',
    created: new Date().toISOString(),
    updatedAt: new Date()
  }
};

let client;
let testDb;
let deliveryDb;
let appDb;

describe('Delivery Status Notifications', () => {
  beforeAll(async () => {
    // Initialize database connection
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    
    testDb = client.db(TEST_CONFIG.TEST_DB_NAME);
    deliveryDb = client.db(TEST_CONFIG.DELIVERY_DB_NAME);
    appDb = client.db(TEST_CONFIG.APP_DB_NAME);
    
    // Initialize database with required collections
    const dbInitService = new DatabaseInitializationService();
    await dbInitService.initializeDatabase(testDb);
    await dbInitService.initializeDatabase(deliveryDb);
    await dbInitService.initializeDatabase(appDb);
    
    // Set up test data
    TEST_DATA.deliveryOrder.customerId = TEST_DATA.customer._id.toString();
    TEST_DATA.deliveryOrder.driver = {
      _id: TEST_DATA.driver._id,
      name: TEST_DATA.driver.fullName,
      phone: TEST_DATA.driver.phone
    };
  });

  afterAll(async () => {
    // Clean up test databases
    await client.db(TEST_CONFIG.TEST_DB_NAME).dropDatabase();
    await client.db(TEST_CONFIG.DELIVERY_DB_NAME).dropDatabase();
    await client.db(TEST_CONFIG.APP_DB_NAME).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    // Clear test data before each test
    await deliveryDb.collection('bookDelivery').deleteMany({});
    await deliveryDb.collection('customers').deleteMany({});
    await appDb.collection('customers').deleteMany({});
    await appDb.collection('notifications').deleteMany({});
    
    // Insert fresh test data
    await deliveryDb.collection('customers').insertOne(TEST_DATA.driver);
    await appDb.collection('customers').insertOne(TEST_DATA.customer);
    await deliveryDb.collection('bookDelivery').insertOne(TEST_DATA.deliveryOrder);
  });

  describe('Driver Order Approval', () => {
    test('should send notification to customer when driver approves order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const driverId = TEST_DATA.driver._id.toString();

      // Approve the order
      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/approve')
        .send({
          orderId,
          driverId
        })
        .expect(200);

      expect(response.body.message).toBe('Order approved');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('2');
      expect(updatedOrder.approvedAt).toBeDefined();

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم تأكيد التوصيل');
      expect(notifications[0].body).toContain('تم تأكيد توصيل طلبك رقم #TEST-DELIVERY-001 من قبل السائق');
      expect(notifications[0].type).toBe('delivery_approved');
      expect(notifications[0].data.deliveryStatus).toBe('2');
    });
  });

  describe('Driver Order Cancellation', () => {
    test('should send notification to customer when driver cancels order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const driverId = TEST_DATA.driver._id.toString();
      const reason = 'Driver unavailable';

      // Cancel the order
      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/cancel')
        .send({
          orderId,
          driverId,
          reason
        })
        .expect(200);

      expect(response.body.message).toBe('Order cancelled');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('-1');
      expect(updatedOrder.cancelledAt).toBeDefined();
      expect(updatedOrder.cancelReason).toBe(reason);

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم إلغاء التوصيل');
      expect(notifications[0].body).toContain('تم إلغاء توصيل طلبك رقم #TEST-DELIVERY-001 من قبل السائق');
      expect(notifications[0].type).toBe('delivery_cancelled_driver');
      expect(notifications[0].data.deliveryStatus).toBe('-1');
      expect(notifications[0].data.cancelReason).toBe(reason);
    });
  });

  describe('Driver Order Start (Collected from Restaurant)', () => {
    test('should send notification to customer when driver starts order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const driverId = TEST_DATA.driver._id.toString();

      // Start the order
      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/start')
        .send({
          orderId,
          driverId
        })
        .expect(200);

      expect(response.body.message).toBe('Order started');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('3');
      expect(updatedOrder.startedAt).toBeDefined();

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم استلام طلبك');
      expect(notifications[0].body).toContain('تم استلام طلبك رقم #TEST-DELIVERY-001 من المطعم وهو في الطريق إليك');
      expect(notifications[0].type).toBe('delivery_collected');
      expect(notifications[0].data.deliveryStatus).toBe('3');
    });
  });

  describe('Driver Order Completion', () => {
    test('should send notification to customer when driver completes order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const driverId = TEST_DATA.driver._id.toString();

      // Complete the order
      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/complete')
        .send({
          orderId,
          driverId
        })
        .expect(200);

      expect(response.body.message).toBe('Order completed');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('4');
      expect(updatedOrder.completedAt).toBeDefined();

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم تسليم طلبك');
      expect(notifications[0].body).toContain('تم تسليم طلبك رقم #TEST-DELIVERY-001 بنجاح. نتمنى لك وجبة شهية!');
      expect(notifications[0].type).toBe('delivery_completed');
      expect(notifications[0].data.deliveryStatus).toBe('4');
    });
  });

  describe('Store Order Cancellation', () => {
    test('should send notification to customer when store cancels order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const reason = 'Restaurant closed';

      // Cancel the order by store
      const response = await request('http://localhost:3000')
        .post('/api/delivery/store/order/cancel')
        .send({
          orderId,
          reason
        })
        .expect(200);

      expect(response.body.message).toBe('Delivery cancelled by store');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('-2');
      expect(updatedOrder.cancelledAt).toBeDefined();
      expect(updatedOrder.cancelReason).toBe(reason);
      expect(updatedOrder.cancelledBy).toBe('store');

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم إلغاء التوصيل من قبل المطعم');
      expect(notifications[0].body).toContain('تم إلغاء توصيل طلبك رقم #TEST-DELIVERY-001 من قبل المطعم');
      expect(notifications[0].type).toBe('delivery_cancelled_store');
      expect(notifications[0].data.deliveryStatus).toBe('-2');
      expect(notifications[0].data.cancelledBy).toBe('store');
    });
  });

  describe('Admin Order Cancellation', () => {
    test('should send notification to customer when admin cancels order', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const reason = 'System error';

      // Cancel the order by admin
      const response = await request('http://localhost:3000')
        .post('/api/delivery/admin/order/cancel')
        .send({
          orderId,
          reason
        })
        .expect(200);

      expect(response.body.message).toBe('Delivery cancelled by admin');

      // Check that the delivery status was updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('-3');
      expect(updatedOrder.cancelledAt).toBeDefined();
      expect(updatedOrder.cancelReason).toBe(reason);
      expect(updatedOrder.cancelledBy).toBe('admin');

      // Check that notification was sent to customer
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toBe('تم إلغاء التوصيل من قبل الإدارة');
      expect(notifications[0].body).toContain('تم إلغاء توصيل طلبك رقم #TEST-DELIVERY-001 من قبل الإدارة');
      expect(notifications[0].type).toBe('delivery_cancelled_admin');
      expect(notifications[0].data.deliveryStatus).toBe('-3');
      expect(notifications[0].data.cancelledBy).toBe('admin');
    });
  });

  describe('General Delivery Status Update', () => {
    test('should handle all delivery status updates with notifications', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const statuses = [
        { status: '1', title: 'في انتظار تأكيد التوصيل', type: 'delivery_status_update' },
        { status: '2', title: 'تم تأكيد التوصيل', type: 'delivery_approved' },
        { status: '3', title: 'تم استلام طلبك', type: 'delivery_collected' },
        { status: '4', title: 'تم تسليم طلبك', type: 'delivery_completed' },
        { status: '-1', title: 'تم إلغاء التوصيل من قبل السائق', type: 'delivery_cancelled_driver' },
        { status: '-2', title: 'تم إلغاء التوصيل من قبل المطعم', type: 'delivery_cancelled_store' },
        { status: '-3', title: 'تم إلغاء التوصيل من قبل الإدارة', type: 'delivery_cancelled_admin' }
      ];

      for (const statusInfo of statuses) {
        // Update delivery status
        const response = await request('http://localhost:3000')
          .post('/api/delivery/order/status/update')
          .send({
            orderId,
            status: statusInfo.status,
            reason: statusInfo.status.startsWith('-') ? 'Test reason' : undefined,
            updatedBy: 'test-user'
          })
          .expect(200);

        expect(response.body.message).toBe('Delivery status updated successfully');

        // Check that the delivery status was updated
        const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
        expect(updatedOrder.status).toBe(statusInfo.status);
        expect(updatedOrder.updatedAt).toBeDefined();

        // Check that notification was sent to customer
        const notifications = await appDb.collection('notifications').find({
          recipientId: TEST_DATA.customer._id.toString(),
          type: statusInfo.type
        }).toArray();

        expect(notifications).toHaveLength(1);
        expect(notifications[0].title).toBe(statusInfo.title);
        expect(notifications[0].data.deliveryStatus).toBe(statusInfo.status);
        expect(notifications[0].data.updatedBy).toBe('test-user');

        // Clear notifications for next iteration
        await appDb.collection('notifications').deleteMany({});
      }
    });

    test('should reject invalid delivery status', async () => {
      const orderId = TEST_DATA.deliveryOrder._id.toString();

      const response = await request('http://localhost:3000')
        .post('/api/delivery/order/status/update')
        .send({
          orderId,
          status: '99', // Invalid status
          updatedBy: 'test-user'
        })
        .expect(400);

      expect(response.body.message).toBe('Invalid delivery status');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing order gracefully', async () => {
      const nonExistentOrderId = new ObjectId().toString();
      const driverId = TEST_DATA.driver._id.toString();

      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/approve')
        .send({
          orderId: nonExistentOrderId,
          driverId
        })
        .expect(200); // The endpoint doesn't fail if order not found, just doesn't send notification

      // Should not have sent any notifications
      const notifications = await appDb.collection('notifications').find({
        recipientId: TEST_DATA.customer._id.toString()
      }).toArray();

      expect(notifications).toHaveLength(0);
    });

    test('should handle notification service errors gracefully', async () => {
      // This test would require mocking the notification service to throw an error
      // For now, we'll test that the delivery update still succeeds even if notification fails
      const orderId = TEST_DATA.deliveryOrder._id.toString();
      const driverId = TEST_DATA.driver._id.toString();

      // Remove customerId to simulate notification failure
      await deliveryDb.collection('bookDelivery').updateOne(
        { _id: TEST_DATA.deliveryOrder._id },
        { $unset: { customerId: "" } }
      );

      const response = await request('http://localhost:3000')
        .post('/api/delivery/driver/order/approve')
        .send({
          orderId,
          driverId
        })
        .expect(200);

      expect(response.body.message).toBe('Order approved');

      // Check that the delivery status was still updated
      const updatedOrder = await deliveryDb.collection('bookDelivery').findOne({ _id: TEST_DATA.deliveryOrder._id });
      expect(updatedOrder.status).toBe('2');
    });
  });
});

// Helper function to run tests
async function runDeliveryStatusNotificationTests() {
  console.log('🚀 Starting Delivery Status Notification Tests...');
  
  try {
    // Import and run the test suite
    const { execSync } = require('child_process');
    execSync('npm test -- test-delivery-status-notifications.js', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log('✅ All delivery status notification tests passed!');
  } catch (error) {
    console.error('❌ Some delivery status notification tests failed:', error.message);
    process.exit(1);
  }
}

// Export for manual testing
module.exports = {
  runDeliveryStatusNotificationTests,
  TEST_DATA,
  TEST_CONFIG
};

// Run tests if this file is executed directly
if (require.main === module) {
  runDeliveryStatusNotificationTests();
} 