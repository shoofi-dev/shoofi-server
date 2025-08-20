const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:1111';
const TEST_STORE_ID = 'your_test_store_id_here'; // Replace with actual store ID

// Test functions
async function testMockStoreFunctionality() {
  console.log('🧪 Testing Mock Store Functionality...\n');

  try {
    // Test 1: Mark store as mock with type
    console.log('1. Testing: Mark store as mock with type');
    try {
      const markAsMockResponse = await axios.post(`${BASE_URL}/api/shoofiAdmin/store/mark-as-mock`, {
        storeId: TEST_STORE_ID,
        mockType: 'supermarket'
      });
      console.log('✅ Store marked as mock store successfully:', markAsMockResponse.data);
    } catch (error) {
      console.log('❌ Failed to mark store as mock:', error.response?.data || error.message);
    }

    // Test 2: Get mock stores
    console.log('\n2. Testing: Get mock stores');
    try {
      const mockStoresResponse = await axios.get(`${BASE_URL}/api/shoofiAdmin/store/mock-stores`);
      console.log('✅ Mock stores retrieved successfully:', mockStoresResponse.data);
    } catch (error) {
      console.log('❌ Failed to get mock stores:', error.response?.data || error.message);
    }

    // Test 3: Get mock types
    console.log('\n3. Testing: Get mock types');
    try {
      const mockTypesResponse = await axios.get(`${BASE_URL}/api/shoofiAdmin/store/mock-types`);
      console.log('✅ Mock types retrieved successfully:', mockTypesResponse.data);
    } catch (error) {
      console.log('❌ Failed to get mock types:', error.response?.data || error.message);
    }

    // Test 4: Get mock stores by type
    console.log('\n4. Testing: Get mock stores by type');
    try {
      const mockStoresByTypeResponse = await axios.get(`${BASE_URL}/api/shoofiAdmin/store/mock-stores/supermarket`);
      console.log('✅ Mock stores by type retrieved successfully:', mockStoresByTypeResponse.data);
    } catch (error) {
      console.log('❌ Failed to get mock stores by type:', error.response?.data || error.message);
    }

    // Test 5: Get mock store products
    console.log('\n5. Testing: Get mock store products');
    try {
      const mockProductsResponse = await axios.get(`${BASE_URL}/api/shoofiAdmin/store/${TEST_STORE_ID}/mock-products`);
      console.log('✅ Mock store products retrieved successfully:', mockProductsResponse.data);
    } catch (error) {
      console.log('❌ Failed to get mock store products:', error.response?.data || error.message);
    }

    // Test 6: Create store from mock (if we have a mock store)
    console.log('\n6. Testing: Create store from mock');
    try {
      const createFromMockResponse = await axios.post(`${BASE_URL}/api/shoofiAdmin/store/create-from-mock`, {
        mockStoreAppName: TEST_STORE_ID,
        newStoreData: {
          appName: `test-store-${Date.now()}`,
          name_ar: 'Test Store Arabic',
          name_he: 'Test Store Hebrew',
          descriptionAR: 'Test store created from mock',
          descriptionHE: 'Test store created from mock',
          business_visible: true,
          categoryIds: [],
          supportedCities: [],
          hasGeneralCategories: false,
          phone: '+1234567890',
          address: 'Test Address'
        }
      });
      console.log('✅ Store created from mock successfully:', createFromMockResponse.data);
    } catch (error) {
      console.log('❌ Failed to create store from mock:', error.response?.data || error.message);
    }

    // Test 7: Test product endpoints (requires app-name header)
    console.log('\n7. Testing: Product endpoints');
    try {
      const mockProductsResponse = await axios.get(`${BASE_URL}/api/product/mock-store/${TEST_STORE_ID}`);
      console.log('✅ Mock store products retrieved successfully:', mockProductsResponse.data);
    } catch (error) {
      console.log('❌ Failed to get mock store products:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Helper function to check if server is running
async function checkServerStatus() {
  try {
    const response = await axios.get(`${BASE_URL}/api/store/get`);
    console.log('✅ Server is running and accessible');
    return true;
  } catch (error) {
    console.log('❌ Server is not accessible. Make sure it\'s running on port 1111');
    return false;
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Mock Store Functionality Tests\n');
  
  // Check server status first
  const serverRunning = await checkServerStatus();
  if (!serverRunning) {
    console.log('\n❌ Cannot proceed with tests. Server is not accessible.');
    return;
  }

  // Run tests
  await testMockStoreFunctionality();
  
  console.log('\n🏁 Tests completed!');
  console.log('\n📝 Note: Some tests may fail if:');
  console.log('   - The test store ID is invalid');
  console.log('   - The store is not properly configured');
  console.log('   - Required headers are missing');
  console.log('\n🔧 To run tests with a real store:');
  console.log('   1. Replace TEST_STORE_ID with a valid store ID');
  console.log('   2. Ensure the store has products and categories');
  console.log('   3. Make sure the server is running and accessible');
  console.log('\n🆕 New Features Tested:');
  console.log('   - Mock store types (supermarket, etc.)');
  console.log('   - Mock type source selection');
  console.log('   - Store creation with type constraints');
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testMockStoreFunctionality,
  checkServerStatus
};
