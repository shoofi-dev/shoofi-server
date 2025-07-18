const axios = require('axios');
const fs = require('fs');

async function testInvoiceGeneration() {
  try {
    console.log('Testing invoice generation endpoint...');
    
    const response = await axios.post('http://localhost:1111/api/order/generate-invoice-image', {
      orderId: 'TEST123',
      appName: 'shoofi'
    }, {
      responseType: 'arraybuffer',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer your-test-token-here' // You'll need to replace this with a valid token
      }
    });

    if (response.data && response.data.byteLength > 0) {
      console.log(`✅ Success! Generated image size: ${response.data.byteLength} bytes`);
      
      // Save the image to a file for inspection
      fs.writeFileSync('test-invoice.png', response.data);
      console.log('✅ Image saved as test-invoice.png');
    } else {
      console.log('❌ Generated image is empty');
    }
  } catch (error) {
    console.error('❌ Error testing invoice generation:', error.response?.data || error.message);
  }
}

testInvoiceGeneration(); 