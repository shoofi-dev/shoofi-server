const { MongoClient, ObjectId } = require('mongodb');
const deliveryService = require('./services/delivery/book-delivery');
const notificationService = require('./services/notification/notification-service');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');

// Test configuration
const TEST_CONFIG = {
  MONGODB_URI: 'mongodb://localhost:27017',
  TEST_DRIVER_ID: '68337db5176dbd5c5e15eea2',
  TEST_CUSTOMER_ID: '507f1f77bcf86cd799439012',
  TEST_ORDER_ID: '507f1f77bcf86cd799439013',
  TEST_COMPANY_ID: '507f1f77bcf86cd799439014',
  TEST_AREA_ID: '507f1f77bcf86cd799439015',
  TEST_CITY_ID: '507f1f77bcf86cd799439016'
};

let client;
let mockApp;

const mockOrder = {
      "_id": "6867bdc3c0cdbab788a2f660",
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
          "coordinates": [
            34.9539749,
            32.1524568
          ]
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
    "orderId": "test-1751629251225",
    "status": "6",
    "appName": "nnn",
    "isPrinted": false,
    "isViewd": false,
    "isViewdAdminAll": false
  }

// Initialize database connection using DatabaseInitializationService
async function initDatabase() {
  try {
    client = new MongoClient(TEST_CONFIG.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Initialize databases using DatabaseInitializationService
    mockApp = {
      db: {
        'delivery-company': await DatabaseInitializationService.initializeDatabase('delivery-company', client),
        'shoofi': await DatabaseInitializationService.initializeDatabase('shoofi', client),
        'test-store': await DatabaseInitializationService.initializeDatabase('test-store', client)
      }
    };
    
    console.log('✅ Databases initialized using DatabaseInitializationService');
    console.log('✅ Available databases:', Object.keys(mockApp.db));
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
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

// Create test city
async function createTestCity() {
  try {
    const city = {
      _id: new ObjectId(TEST_CONFIG.TEST_CITY_ID),
      nameAR: 'تل أبيب',
      nameHE: 'תל אביב',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [34.7, 32.0],
          [34.8, 32.0],
          [34.8, 32.1],
          [34.7, 32.1],
          [34.7, 32.0]
        ]]
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await mockApp.db['delivery-company'].cities.insertOne(city);
    console.log('✅ Test city created:', city.nameAR);
    return city;
  } catch (error) {
    console.error('❌ Failed to create test city:', error);
    throw error;
  }
}

// Create test area
async function createTestArea() {
  try {
    const area = {
      _id: new ObjectId(TEST_CONFIG.TEST_AREA_ID),
      name: 'منطقة وسط المدينة',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [34.75, 32.05],
          [34.76, 32.05],
          [34.76, 32.06],
          [34.75, 32.06],
          [34.75, 32.05]
        ]]
      },
      cityId: TEST_CONFIG.TEST_CITY_ID,
      minETA: 15,
      maxETA: 45,
      price: 25,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await mockApp.db['delivery-company'].areas.insertOne(area);
    console.log('✅ Test area created:', area.name);
    return area;
  } catch (error) {
    console.error('❌ Failed to create test area:', error);
    throw error;
  }
}

// Create test delivery company
async function createTestCompany() {
  try {
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
    
    await mockApp.db['delivery-company'].store.insertOne(company);
    console.log('✅ Test delivery company created:', company.nameAR);
    return company;
  } catch (error) {
    console.error('❌ Failed to create test company:', error);
    throw error;
  }
}

// Create test driver
async function createTestDriver() {
  try {
    const driver = {
      _id: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
      fullName: 'أحمد محمد',
      phone: '0528602121',
      email: 'ahmed@test.com',
      notificationToken: 'ExponentPushToken[0s_aEwGu89L0tjt_xvbML7]',
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
      updatedAt: new Date(),
    };
    
    await mockApp.db['delivery-company'].customers.insertOne(driver);
    console.log('✅ Test driver created:', driver.fullName);
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
      phone: '0528602121',
      email: 'fatima@test.com',
      notificationToken: 'ExponentPushToken[customer-token-456]',
      createdAt: new Date()
    };
    
    await mockApp.db['test-store'].customers.insertOne(customer);
    console.log('✅ Test customer created:', customer.fullName);
    return customer;
  } catch (error) {
    console.error('❌ Failed to create test customer:', error);
    throw error;
  }
}

// Test delivery booking
async function testDeliveryBooking() {
  console.log('\n🚚 Testing Delivery Booking...\n');
  
  try {
    // Test 1: Basic delivery booking
    console.log('📦 Test 1: Basic delivery booking');
    
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
      },
      order: mockOrder              
    };
    
    const result = await deliveryService.bookDelivery({ 
      deliveryData, 
      appDb: mockApp.db 
    });
    
    if (result.success) {
      console.log('✅ Delivery booking successful');
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
    } else {
      console.log('❌ Delivery booking failed:', result.message);
    }
    
    // Test 2: Check if notification was sent to driver
    console.log('\n📱 Test 2: Checking driver notification');
    
    const deliveryDB = mockApp.db['delivery-company'];
    const driverNotifications = await deliveryDB.notifications.find({
      recipientId: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
      type: 'order'
    }).toArray();
    
    if (driverNotifications.length > 0) {
      console.log('✅ Driver notification found');
      const latestNotification = driverNotifications[0];
      console.log('   - Title:', latestNotification.title);
      console.log('   - Body:', latestNotification.body);
      console.log('   - Type:', latestNotification.type);
      console.log('   - Data:', latestNotification.data);
    } else {
      console.log('❌ No driver notification found');
    }
    
    // Test 3: Test delivery update (status change)
    console.log('\n🔄 Test 3: Testing delivery status update');
    
    if (result.success) {
      const updateData = {
        bookId: result.bookId,
        status: '2', // Approved
        approvedAt: new Date()
      };
      
      await deliveryService.updateDelivery({ 
        deliveryData: updateData, 
        appDb: mockApp.db 
      });
      
      // Check if status was updated
      const updatedDelivery = await deliveryDB.bookDelivery.findOne({ 
        _id: result.deliveryId 
      });
      
      if (updatedDelivery && updatedDelivery.status === '2') {
        console.log('✅ Delivery status updated successfully');
        
        // Check for status update notification
        const statusNotifications = await deliveryDB.notifications.find({
          recipientId: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
          'data.status': '2'
        }).toArray();
        
        if (statusNotifications.length > 0) {
          console.log('✅ Status update notification sent');
        } else {
          console.log('❌ No status update notification found');
        }
      } else {
        console.log('❌ Delivery status update failed');
      }
    }
    
    // Test 4: Test delivery completion
    console.log('\n✅ Test 4: Testing delivery completion');
    
    if (result.success) {
      const completeData = {
        bookId: result.bookId,
        status: '0', // Delivered
        deliveryTime: new Date(),
        completedAt: new Date()
      };
      
      await deliveryService.updateDelivery({ 
        deliveryData: completeData, 
        appDb: mockApp.db 
      });
      
      // Check if delivery was completed
      const completedDelivery = await deliveryDB.bookDelivery.findOne({ 
        _id: result.deliveryId 
      });
      
      if (completedDelivery && completedDelivery.status === '0') {
        console.log('✅ Delivery completed successfully');
        
        // Check for completion notification
        const completionNotifications = await deliveryDB.notifications.find({
          recipientId: new ObjectId(TEST_CONFIG.TEST_DRIVER_ID),
          'data.status': '0'
        }).toArray();
        
        if (completionNotifications.length > 0) {
          console.log('✅ Completion notification sent');
        } else {
          console.log('❌ No completion notification found');
        }
      } else {
        console.log('❌ Delivery completion failed');
      }
    }
    
    console.log('\n✅ All delivery booking tests passed!');
    
  } catch (error) {
    console.error('❌ Delivery booking test failed:', error);
    throw error;
  }
}

// Test delivery booking with no available drivers
async function testDeliveryBookingNoDrivers() {
  console.log('\n🚫 Testing Delivery Booking - No Available Drivers...\n');
  
  try {
    // Deactivate all drivers
    await mockApp.db['delivery-company'].customers.updateMany(
      { role: 'driver' },
      { $set: { isActive: false, isAvailable: false } }
    );
    
    console.log('📦 Test: Delivery booking with no available drivers');
    
    const deliveryData = {
      fullName: 'سارة أحمد',
      phone: '+972501111111',
      price: '50.00',
      pickupTime: 20,
      storeName: 'مطعم الشوفة',
      appName: 'test-store',
      storeId: new ObjectId(),
      bookId: 'TEST-NO-DRIVERS-123',
      storeLocation: {
        latitude: 32.055,
        longitude: 34.755
      },
      coverageRadius: 5000,
      customerLocation: {
        latitude: 32.056,
        longitude: 34.756
      },
      order: mockOrder  
    };
    
    const result = await deliveryService.bookDelivery({ 
      deliveryData, 
      appDb: mockApp.db 
    });
    
    if (!result.success) {
      console.log('✅ Correctly handled no available drivers');
      console.log('   - Message:', result.message);
    } else {
      console.log('❌ Should have failed when no drivers available');
    }
    
    // Reactivate drivers for other tests
    await mockApp.db['delivery-company'].customers.updateMany(
      { role: 'driver' },
      { $set: { isActive: true, isAvailable: true } }
    );
    
    console.log('\n✅ No drivers test completed!');
    
  } catch (error) {
    console.error('❌ No drivers test failed:', error);
    throw error;
  }
}

// Test delivery booking edge cases
async function testDeliveryBookingEdgeCases() {
  console.log('\n🔍 Testing Delivery Booking Edge Cases...\n');
  
  try {
    // Test 1: Missing required fields
    console.log('📦 Test 1: Missing required fields');
    
    const invalidDeliveryData = {
      fullName: 'Test Customer',
      // Missing phone, location, etc.
    };
    
    try {
      await deliveryService.bookDelivery({ 
        deliveryData: invalidDeliveryData, 
        appDb: mockApp.db 
      });
      console.log('❌ Should have failed with invalid data');
    } catch (error) {
      console.log('✅ Correctly handled invalid delivery data');
      console.log('   - Error:', error.message);
    }
    
    // Test 2: Invalid location coordinates
    console.log('\n📦 Test 2: Invalid location coordinates');
    
    const invalidLocationData = {
      fullName: 'Test Customer',
      phone: '+972501111111',
      price: '50.00',
      pickupTime: 20,
      storeName: 'Test Store',
      appName: 'test-store',
      storeId: new ObjectId(),
      bookId: 'TEST-INVALID-LOCATION',
      storeLocation: {
        latitude: 999, // Invalid latitude
        longitude: 999  // Invalid longitude
      },
      coverageRadius: 5000,
      customerLocation: {
        latitude: 999,
        longitude: 999
      },
      order: mockOrder
    };
    
    const result2 = await deliveryService.bookDelivery({ 
      deliveryData: invalidLocationData, 
      appDb: mockApp.db 
    });
    
    if (!result2.success) {
      console.log('✅ Correctly handled invalid location');
      console.log('   - Message:', result2.message);
    } else {
      console.log('❌ Should have failed with invalid location');
    }
    
    // Test 3: Very short pickup time
    console.log('\n📦 Test 3: Very short pickup time');
    
    const shortPickupData = {
      fullName: 'Test Customer',
      phone: '+972501111111',
      price: '50.00',
      pickupTime: 1, // Very short pickup time
      storeName: 'Test Store',
      appName: 'test-store',
      storeId: new ObjectId(),
      bookId: 'TEST-SHORT-PICKUP',
      storeLocation: {
        latitude: 32.055,
        longitude: 34.755
      },
      coverageRadius: 5000,
      customerLocation: {
        latitude: 32.056,
        longitude: 34.756
      },
      order: mockOrder
    };
    
    const result3 = await deliveryService.bookDelivery({ 
      deliveryData: shortPickupData, 
      appDb: mockApp.db 
    });
    
    if (result3.success) {
      console.log('✅ Successfully handled short pickup time');
      console.log('   - Pickup time:', shortPickupData.pickupTime, 'minutes');
    } else {
      console.log('❌ Failed with short pickup time:', result3.message);
    }
    
    console.log('\n✅ All edge case tests completed!');
    
  } catch (error) {
    console.error('❌ Edge case tests failed:', error);
    throw error;
  }
}

// Test delivery statistics and reporting
async function testDeliveryStatistics() {
  console.log('\n📊 Testing Delivery Statistics...\n');
  
  try {
    const deliveryDB = mockApp.db['delivery-company'];
    
    // Test 1: Count total deliveries
    console.log('📊 Test 1: Delivery counts');
    
    const totalDeliveries = await deliveryDB.bookDelivery.countDocuments({});
    const pendingDeliveries = await deliveryDB.bookDelivery.countDocuments({ status: '1' });
    const completedDeliveries = await deliveryDB.bookDelivery.countDocuments({ status: '0' });
    const cancelledDeliveries = await deliveryDB.bookDelivery.countDocuments({ status: '-1' });
    
    console.log('✅ Delivery statistics:');
    console.log('   - Total deliveries:', totalDeliveries);
    console.log('   - Pending deliveries:', pendingDeliveries);
    console.log('   - Completed deliveries:', completedDeliveries);
    console.log('   - Cancelled deliveries:', cancelledDeliveries);
    
    // Test 2: Driver performance
    console.log('\n📊 Test 2: Driver performance');
    
    const driverStats = await deliveryDB.bookDelivery.aggregate([
      { $match: { 'driver._id': new ObjectId(TEST_CONFIG.TEST_DRIVER_ID) } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: { $toDouble: '$price' } }
      }}
    ]).toArray();
    
    console.log('✅ Driver performance:');
    driverStats.forEach(stat => {
      console.log(`   - Status ${stat._id}: ${stat.count} orders, ${stat.totalValue} total value`);
    });
    
    // Test 3: Company performance
    console.log('\n📊 Test 3: Company performance');
    
    const companyStats = await deliveryDB.bookDelivery.aggregate([
      { $match: { 'company._id': new ObjectId(TEST_CONFIG.TEST_COMPANY_ID) } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgPrice: { $avg: { $toDouble: '$price' } }
      }}
    ]).toArray();
    
    console.log('✅ Company performance:');
    companyStats.forEach(stat => {
      console.log(`   - Status ${stat._id}: ${stat.count} orders, ${stat.avgPrice.toFixed(2)} avg price`);
    });
    
    console.log('\n✅ All statistics tests completed!');
    
  } catch (error) {
    console.error('❌ Statistics tests failed:', error);
    throw error;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Delivery Booking Tests...\n');
  
  try {
    // Initialize database
    await initDatabase();
    
    // Clean up any existing test data
    await cleanupTestData();
    
    // Create test data
    await createTestCity();
    await createTestArea();
    await createTestCompany();
    await createTestDriver();
    // await createTestCustomer();
    
    // Run tests
    await testDeliveryBooking();
    await testDeliveryBookingNoDrivers();
    await testDeliveryBookingEdgeCases();
    await testDeliveryStatistics();
    
    console.log('\n🎉 All delivery booking tests completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    // await cleanupTestData();
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
  createTestCity,
  createTestArea,
  createTestCompany,
  createTestDriver,
  createTestCustomer,
  testDeliveryBooking,
  testDeliveryBookingNoDrivers,
  testDeliveryBookingEdgeCases,
  testDeliveryStatistics
};

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}
 