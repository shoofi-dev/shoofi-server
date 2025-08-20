require('dotenv').config({ path: '.env.production' });
const { MongoClient } = require('mongodb');
const DatabaseInitializationService = require('./services/database/DatabaseInitializationService');

// MongoDB script to check all databases for stores missing maxReady or minReady
// Usage: node checkStores.js

async function checkStores() {
  let client;
  
  try {
    // Connect to MongoDB
    const connectionString = process.env.DB_CONNECTION_STRING || 'mongodb://127.0.0.1:27017';
    client = new MongoClient(connectionString, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Get stores list from admin database
    const shoofiDb = client.db('shoofi');
    const storesList = await shoofiDb.collection('stores').find().toArray();
  
      console.log('Checking all stores for missing maxReady or minReady...\n');
    
    let totalMissing = 0;
    
    // Loop through each store database
    for (let i = 0; i < storesList.length; i++) {
      const dbName = storesList[i].appName;
      
      try {
        // Get the database
        const currentDb = client.db(dbName);
        
        // Check if the store collection exists
        const collections = await currentDb.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        if (!collectionNames.includes('store')) {
          continue; // Skip databases without store collection
        }
        
        // Get store data
        const storeDataArr = await currentDb.collection('store').find().toArray();
        
        if (storeDataArr.length === 0) {
          continue; // Skip if no store data
        }
        
        // Count documents missing maxReady or minReady
        const missingCount = await currentDb.collection('store').countDocuments({
          $or: [
            { maxReady: { $exists: false } },
            { minReady: { $exists: false } }
          ]
        });
        
        if (missingCount > 0) {
          console.log(`DB: ${dbName} → ${missingCount} docs missing maxReady or minReady`);
          totalMissing += missingCount;
        }
        
      } catch (error) {
        console.error(`Error checking database ${dbName}:`, error.message);
      }
    }
    
    console.log(`\nTotal documents missing maxReady or minReady: ${totalMissing}`);
    
  } catch (error) {
    console.error('Script execution failed:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('✅ MongoDB connection closed');
    }
  }
}

// Run the script
checkStores().catch(console.error);
