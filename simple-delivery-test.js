const { MongoClient, ObjectId } = require('mongodb');
const deliveryService = require('./services/delivery/book-delivery');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');

// Simple test configuration
const TEST_CONFIG = {
  MONGODB_URI: 'mongodb://localhost:27017',
  TEST_DRIVER_ID: '68337db5176dbd5c5e15eea2',
  TEST_COMPANY_ID: '507f1f77bcf86cd799439014',
  TEST_AREA_ID: '507f1f77bcf86cd799439015',
  TEST_CITY_ID: '507f1f77bcf86cd799439016'
};

let client;
let mockApp;

// Initialize database
async function initDatabase() {
  try {
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    mockApp = {
      db: {
        'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client),
        'test-store': await DatabaseInitializationService.initializeDatabase('test-store', client)
      }
    };
    
    console.log('✅ Databases initialized');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Create minimal test data
async function createTestData() {
  try {
    const deliveryDB = mockApp.db['delivery-company'];
    
    // Create test city
    const city = {
      _id: new ObjectId(TEST_CONFIG.TEST_CITY_ID),
      nameAR: 'تل أبيب',
      nameHE: 'תל אביב',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [34.7, 32.0], [34.8, 32.0], [34.8, 32.1], [34.7, 32.1], [34.7, 32.0]
        ]]
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await deliveryDB.cities.insertOne(city);
    
    // Create test area
    const area = {
      _id: new ObjectId(TEST_CONFIG.TEST_AREA_ID),
      name: 'منطقة وسط المدينة',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [34.75, 32.05], [34.76, 32.05], [34.76, 32.06], [34.75, 32.06], [34.75, 32.05]
        ]]
      },
      cityId: TEST_CONFIG.TEST_CITY_ID,
      minETA: 15,
      maxETA: 45,
      price: 25,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await deliveryDB.areas.insertOne(area);
    
    // Create test company
    const company = {
      _id: new ObjectId(TEST_CONFIG.TEST_COMPANY_ID),
      nameAR: 'شركة التوصيل السريع',
      nameHE: 'חברת משלוחים מהירים',
      start: '08:00',
      end: '22:00',
      isStoreClose: false,
      isAlwaysOpen: true,
      phone: '+972501234567',
      email: 'delivery@test.com',
      status: true,
      order: 1,
      supportedCities: [new ObjectId(TEST_CONFIG.TEST_CITY_ID)],
      supportedAreas: [
        {
          areaId: new ObjectId(TEST_CONFIG.TEST_AREA_ID),
          price: 25,
          minOrder: 50,
          eta: 30
        }
      ],
      location: {
        type: 'Point',
        coordinates: [34.755, 32.055]
      },
      coverageRadius: 10000,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await deliveryDB.store.insertOne(company);
    
    // Create test driver
    const driver = {
      _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
      fullName: 'أحمد محمد',
      phone: '+972501234567',
      email: 'ahmed@test.com',
      notificationToken: 'ExponentPushToken[test-token-123]',
      role: 'driver',
      isActive: true,
      isAvailable: true,
      companyId: TEST_CONFIG.TEST_COMPANY_ID,
      currentLocation: {
        latitude: 32.055,
        longitude: 34.755
      },
      lastLocationUpdate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await deliveryDB.customers.insertOne(driver);
    
    console.log('✅ Test data created successfully');
    
  } catch (error) {
    console.error('❌ Failed to create test data:', error);
    throw error;
  }
}

// Clean up test data
async function cleanupTestData() {
  try {
    const deliveryDB = mockApp.db['delivery-company'];
    await deliveryDB.notifications.deleteMany({});
    await deliveryDB.customers.deleteMany({});
    await deliveryDB.bookDelivery.deleteMany({});
    await deliveryDB.store.deleteMany({});
    await deliveryDB.areas.deleteMany({});
    await deliveryDB.cities.deleteMany({});
    console.log('✅ Test data cleaned up');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Test delivery booking
async function testDeliveryBooking() {
  console.log('\n🚚 Testing Delivery Booking...\n');
  
  try {
    const deliveryData = {
      fullName: 'فاطمة علي',
      phone: '+972509876543',
      price: '75.00',
      pickupTime: 30,
      storeName: 'مطعم الشوفة',
      appName: 'test-store',
      storeId: new ObjectId(),
      bookId: 'TEST-12345-678901-1234',
      storeLocation: {
        latitude: 32.055,
        longitude: 34.755
      },
      coverageRadius: 5000,
      customerLocation: {
        latitude: 32.056,
        longitude: 34.756
      },
      order: {
        payment_method: 'CASH',
        receipt_method: 'DELIVERY',
        geo_positioning: {
          latitude: 32.056,
          longitude: 34.756
        },
        items: [
          {
            item_id: new ObjectId(),
            name: 'برجر لحم',
            qty: 2,
            price: 35
          },
          {
            item_id: new ObjectId(),
            name: 'بطاطس مقلية',
            qty: 1,
            price: 15
          }
        ]
      }
    };
    
    console.log('📦 Attempting delivery booking...');
    
    const result = await deliveryService.bookDelivery({ 
      deliveryData, 
      appDb: mockApp.db 
    });
    
    if (result.success) {
      console.log('✅ Delivery booking successful!');
      console.log('   - Delivery ID:', result.deliveryId);
      console.log('   - Book ID:', result.bookId);
      
      // Verify the delivery was created in database
      const deliveryDB = mockApp.db['delivery-company'];
      const createdDelivery = await deliveryDB.bookDelivery.findOne({ 
        _id: result.deliveryId 
      });
      
      if (createdDelivery) {
        console.log('✅ Delivery record found in database');
        console.log('   - Status:', createdDelivery.status);
        console.log('   - Driver:', createdDelivery.driver?.fullName);
        console.log('   - Company:', createdDelivery.company?.nameAR);
        console.log('   - Area:', createdDelivery.area?.name);
        console.log('   - Expected Delivery:', createdDelivery.expectedDeliveryAt);
      } else {
        console.log('❌ Delivery record not found in database');
      }
      
      // Check if notification was sent to driver
      const driverNotifications = await deliveryDB.notifications.find({
        recipientId: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
        type: 'order'
      }).toArray();
      
      if (driverNotifications.length > 0) {
        console.log('✅ Driver notification sent');
        console.log('   - Title:', driverNotifications[0].title);
        console.log('   - Body:', driverNotifications[0].body);
      } else {
        console.log('❌ No driver notification found');
      }
      
    } else {
      console.log('❌ Delivery booking failed:', result.message);
    }
    
  } catch (error) {
    console.error('❌ Delivery booking test failed:', error);
    throw error;
  }
}

// Main test runner
async function runTest() {
  console.log('🚀 Starting Simple Delivery Booking Test...\n');
  
  try {
    // Initialize database
    await initDatabase();
    
    // Clean up any existing test data
    await cleanupTestData();
    
    // Create test data
    await createTestData();
    
    // Run test
    await testDeliveryBooking();
    
    console.log('\n🎉 Delivery booking test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test failed:', error);
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

// Run test if this file is executed directly
if (require.main === module) {
  runTest();
}

module.exports = { runTest }; 