const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Test configuration
const WS_URL = 'ws://localhost:1111';
const TEST_USER_ID = 'test_user_123';
const TEST_APP_NAME = 'shoofi-app';
const TEST_APP_TYPE = 'customer';
const JWT_SECRET = process.env.JWT_SECRET || 'test_secret';

// Generate test JWT token
const generateTestToken = (userId) => {
  return jwt.sign(
    { 
      customerId: userId,
      appName: TEST_APP_NAME,
      appType: TEST_APP_TYPE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
    },
    JWT_SECRET
  );
};

// Test WebSocket connection
const testWebSocketConnection = async () => {
  console.log('🧪 Testing WebSocket Connection...');
  
  const token = generateTestToken(TEST_USER_ID);
  const wsUrl = `${WS_URL}?customerId=${TEST_USER_ID}&appName=${TEST_APP_NAME}&token=${token}&appType=${TEST_APP_TYPE}`;
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let testResults = {
      connection: false,
      authentication: false,
      messageReceived: false,
      pingPong: false,
      roomJoin: false,
      errors: []
    };

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Test timeout after 10 seconds'));
    }, 10000);

    ws.on('open', () => {
      console.log('✅ WebSocket connection established');
      testResults.connection = true;
      
      // Send ping message
      ws.send(JSON.stringify({
        type: 'ping',
        data: { timestamp: Date.now() }
      }));
      
      // Join a test room
      ws.send(JSON.stringify({
        type: 'join_room',
        data: { room: 'test_room' }
      }));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received message:', message.type);
        
        if (message.type === 'connection_established') {
          testResults.authentication = true;
          console.log('✅ Authentication successful');
        }
        
        if (message.type === 'pong') {
          testResults.pingPong = true;
          console.log('✅ Ping/Pong working');
        }
        
        if (message.type === 'room_joined') {
          testResults.roomJoin = true;
          console.log('✅ Room join successful');
        }
        
        // Close connection after receiving expected messages
        if (testResults.authentication && testResults.pingPong) {
          clearTimeout(timeout);
          ws.close(1000, 'Test completed');
        }
        
      } catch (error) {
        testResults.errors.push(`Failed to parse message: ${error.message}`);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
      clearTimeout(timeout);
      resolve(testResults);
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      testResults.errors.push(error.message);
      clearTimeout(timeout);
      reject(error);
    });
  });
};

// Test multiple connections
const testMultipleConnections = async () => {
  console.log('\n🧪 Testing Multiple Connections...');
  
  const connections = [];
  const maxConnections = 5;
  
  for (let i = 0; i < maxConnections; i++) {
    const userId = `test_user_${i}`;
    const token = generateTestToken(userId);
    const wsUrl = `${WS_URL}?customerId=${userId}&appName=${TEST_APP_NAME}&token=${token}&appType=${TEST_APP_TYPE}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      connections.push({ ws, userId });
      
      ws.on('open', () => {
        console.log(`✅ Connection ${i + 1} established for ${userId}`);
      });
      
      ws.on('error', (error) => {
        console.error(`❌ Connection ${i + 1} error:`, error.message);
      });
      
    } catch (error) {
      console.error(`❌ Failed to create connection ${i + 1}:`, error.message);
    }
  }
  
  // Wait a bit then close all connections
  setTimeout(() => {
    connections.forEach(({ ws, userId }) => {
      ws.close(1000, 'Test completed');
      console.log(`🔌 Closed connection for ${userId}`);
    });
  }, 3000);
};

// Test message sending (requires server-side endpoint)
const testMessageSending = async () => {
  console.log('\n🧪 Testing Message Sending...');
  
  // This would require a server endpoint to send messages
  // For now, we'll just test the connection
  const token = generateTestToken(TEST_USER_ID);
  const wsUrl = `${WS_URL}?customerId=${TEST_USER_ID}&appName=${TEST_APP_NAME}&token=${token}&appType=${TEST_APP_TYPE}`;
  
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      console.log('✅ Ready to test message sending');
      
      // Send a test message
      ws.send(JSON.stringify({
        type: 'test_message',
        data: { 
          message: 'Hello from test client',
          timestamp: Date.now()
        }
      }));
      
      setTimeout(() => {
        ws.close(1000, 'Message test completed');
        resolve(true);
      }, 2000);
    });
    
    ws.on('error', (error) => {
      console.error('❌ Message test error:', error.message);
      resolve(false);
    });
  });
};

// Main test runner
const runTests = async () => {
  console.log('🚀 Starting WebSocket Tests...\n');
  
  try {
    // Test 1: Basic connection and authentication
    console.log('=== Test 1: Basic Connection ===');
    const connectionResults = await testWebSocketConnection();
    
    console.log('\n📊 Connection Test Results:');
    console.log(`Connection: ${connectionResults.connection ? '✅' : '❌'}`);
    console.log(`Authentication: ${connectionResults.authentication ? '✅' : '❌'}`);
    console.log(`Ping/Pong: ${connectionResults.pingPong ? '✅' : '❌'}`);
    console.log(`Room Join: ${connectionResults.roomJoin ? '✅' : '❌'}`);
    
    if (connectionResults.errors.length > 0) {
      console.log('\n❌ Errors:');
      connectionResults.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    // Test 2: Multiple connections
    console.log('\n=== Test 2: Multiple Connections ===');
    await testMultipleConnections();
    
    // Test 3: Message sending
    console.log('\n=== Test 3: Message Sending ===');
    await testMessageSending();
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
};

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testWebSocketConnection,
  testMultipleConnections,
  testMessageSending,
  generateTestToken
}; 