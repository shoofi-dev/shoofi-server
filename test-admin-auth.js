const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_PHONE = '1234567890';
const TEST_PASSWORD = 'test123456';

// Test admin user data
const testUser = {
  fullName: 'Test Admin User',
  phoneNumber: TEST_PHONE,
  roles: ['admin']
};

async function testAdminAuth() {
  console.log('🧪 Testing Admin Authentication System\n');

  try {
    // Step 1: Create test admin user
    console.log('1️⃣ Creating test admin user...');
    const createResponse = await axios.post(`${BASE_URL}/api/admin/users`, testUser);
    console.log('✅ User created successfully');
    console.log('   Generated password:', createResponse.data.generatedPassword);
    console.log('   User ID:', createResponse.data.user._id);
    console.log('');

    // Step 2: Login with the user
    console.log('2️⃣ Testing login...');
    const loginResponse = await axios.post(`${BASE_URL}/api/admin/users/login`, {
      phoneNumber: TEST_PHONE,
      password: createResponse.data.generatedPassword
    });
    
    if (loginResponse.data.user && loginResponse.data.token) {
      console.log('✅ Login successful');
      console.log('   User:', loginResponse.data.user.fullName);
      console.log('   Token length:', loginResponse.data.token.length);
      console.log('');
    } else {
      console.log('❌ Login failed - no token received');
      return;
    }

    const accessToken = loginResponse.data.token;

    // Step 3: Test protected route access
    console.log('3️⃣ Testing protected route access...');
    try {
      const protectedResponse = await axios.get(`${BASE_URL}/api/admin/users`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'app-type': 'shoofi-admin'
        }
      });
      console.log('✅ Protected route accessed successfully');
      console.log('   Users count:', protectedResponse.data.users?.length || 0);
      console.log('');
    } catch (error) {
      console.log('❌ Protected route access failed:', error.response?.status, error.response?.data?.message);
      console.log('');
    }

    // Step 4: Test token refresh
    console.log('4️⃣ Testing token refresh...');
    try {
      const refreshResponse = await axios.post(`${BASE_URL}/api/admin/users/refresh-token`, {
        token: accessToken
      });
      
      if (refreshResponse.data.token) {
        console.log('✅ Token refresh successful');
        console.log('   New token length:', refreshResponse.data.token.length);
        console.log('');
      } else {
        console.log('❌ Token refresh failed - no token received');
      }
    } catch (error) {
      console.log('❌ Token refresh failed:', error.response?.status, error.response?.data?.message);
      console.log('');
    }

    // Step 5: Test logout
    console.log('5️⃣ Testing logout...');
    try {
      const logoutResponse = await axios.post(`${BASE_URL}/api/admin/users/logout`, {
        userId: loginResponse.data.user._id
      });
      console.log('✅ Logout successful:', logoutResponse.data.message);
      console.log('');
    } catch (error) {
      console.log('❌ Logout failed:', error.response?.status, error.response?.data?.message);
      console.log('');
    }

    // Step 6: Test access after logout
    console.log('6️⃣ Testing access after logout...');
    try {
      await axios.get(`${BASE_URL}/api/admin/users`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'app-type': 'shoofi-admin'
        }
      });
      console.log('❌ Access still allowed after logout (this might be expected if tokens are not immediately invalidated)');
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ Access properly denied after logout');
      } else {
        console.log('❌ Unexpected error after logout:', error.response?.status, error.response?.data?.message);
      }
    }

    console.log('\n🎉 Admin authentication system test completed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

// Run the test
if (require.main === module) {
  testAdminAuth();
}

module.exports = { testAdminAuth };
