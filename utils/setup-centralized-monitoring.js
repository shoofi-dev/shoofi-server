const { MongoClient } = require('mongodb');

async function setupCentralizedMonitoring() {
  const client = new MongoClient(process.env.DATABASE_CONNECTION_STRING || 'mongodb://127.0.0.1:27017', {
    useUnifiedTopology: true
  });
  
  try {
    await client.connect();
    
    // Use the main shoofi database
    const db = client.db('shoofi');
    
    console.log('🔧 Setting up centralized order flow monitoring...');
    
    // Create orderFlowEvents collection
    await db.createCollection('orderFlowEvents');
    console.log('✅ Created orderFlowEvents collection');
    
    // Get the collection reference
    const collection = db.collection('orderFlowEvents');
    
    // Create indexes for optimal performance
    await collection.createIndex({ orderNumber: 1 });
    console.log('✅ Created index: orderNumber');
    
    await collection.createIndex({ orderId: 1 });
    console.log('✅ Created index: orderId');
    
    await collection.createIndex({ timestamp: 1 });
    console.log('✅ Created index: timestamp');
    
    await collection.createIndex({ sourceApp: 1 });
    console.log('✅ Created index: sourceApp');
    
    await collection.createIndex({ eventType: 1 });
    console.log('✅ Created index: eventType');
    
    await collection.createIndex({ status: 1 });
    console.log('✅ Created index: status');
    
    await collection.createIndex({ actorType: 1 });
    console.log('✅ Created index: actorType');
    
    // Compound indexes for common queries
    await collection.createIndex({ orderNumber: 1, timestamp: -1 });
    console.log('✅ Created compound index: orderNumber + timestamp');
    
    await collection.createIndex({ sourceApp: 1, eventType: 1, timestamp: -1 });
    console.log('✅ Created compound index: sourceApp + eventType + timestamp');
    
    await collection.createIndex({ status: 1, timestamp: -1 });
    console.log('✅ Created compound index: status + timestamp');
    
    await collection.createIndex({ orderNumber: 1, sourceApp: 1 });
    console.log('✅ Created compound index: orderNumber + sourceApp');

    console.log('🎉 Centralized order flow monitoring setup completed successfully!');
    console.log('📊 Collection: shoofi.orderFlowEvents');
    console.log('🔍 You can now track order flows across all apps');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run setup
if (require.main === module) {
  setupCentralizedMonitoring()
    .then(() => {
      console.log('✅ Setup completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupCentralizedMonitoring }; 