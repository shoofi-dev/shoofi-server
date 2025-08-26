const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000'; // Adjust to your server URL
const TEST_PHONE = '+972501234567'; // Adjust to a test phone number

async function testForgotPasswordFlow() {
  console.log('🧪 Testing Forgot Password Flow...\n');

  try {
    // Step 1: Request password reset
    console.log('1️⃣ Requesting password reset...');
    const forgotResponse = await axios.post(`${BASE_URL}/api/admin/users/forgot-password`, {
      phoneNumber: TEST_PHONE
    });
    
    console.log('✅ Forgot password request successful:', forgotResponse.data.message);
    
    // Note: In a real test, you would need to check the SMS or database for the reset code
    console.log('📱 Reset code should be sent via SMS to:', TEST_PHONE);
    console.log('💡 Check your SMS or database for the 6-digit reset code\n');
    
    // Step 2: Verify reset code (you'll need to get the actual code from SMS/database)
    console.log('2️⃣ To test code verification, use the actual reset code from SMS');
    console.log('   POST /api/admin/users/verify-reset-code');
    console.log('   Body: { phoneNumber: "' + TEST_PHONE + '", resetCode: "123456" }\n');
    
    // Step 3: Reset password (you'll need the temp token from step 2)
    console.log('3️⃣ To test password reset, use the temp token from step 2');
    console.log('   POST /api/admin/users/reset-password');
    console.log('   Body: { tempToken: "your_temp_token", newPassword: "newpassword123" }\n');
    
    console.log('🎯 Forgot password infrastructure is working!');
    console.log('📝 Complete the flow by manually testing steps 2 and 3 with real data.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      console.log('💡 Make sure your server is running and the route is accessible');
    }
  }
}

// Run the test
testForgotPasswordFlow();
