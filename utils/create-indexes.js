const { MongoClient } = require('mongodb');

async function createCustomerIndexes() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    // Get all databases
    const adminDb = client.db('admin');
    const databases = await adminDb.listDatabases();
    
    for (const dbInfo of databases.databases) {
      const dbName = dbInfo.name;
      
      // Skip system databases
      if (dbName === 'admin' || dbName === 'local' || dbName === 'config') {
        continue;
      }
      
      const db = client.db(dbName);
      
      // Check if customers collection exists
      const collections = await db.listCollections({ name: 'customers' }).toArray();
      if (collections.length === 0) {
        console.log(`Skipping ${dbName} - no customers collection`);
        continue;
      }
      
      console.log(`Creating indexes for ${dbName}.customers`);
      
      // Create indexes for customer search
      await db.collection('customers').createIndex(
        { phone: 1 },
        { 
          name: 'phone_index',
          background: true 
        }
      );
      
      await db.collection('customers').createIndex(
        { fullName: 1 },
        { 
          name: 'fullName_index',
          background: true 
        }
      );
      
      // Create compound index for phone and fullName search
      await db.collection('customers').createIndex(
        { phone: 1, fullName: 1 },
        { 
          name: 'phone_fullName_compound_index',
          background: true 
        }
      );
      
      // Create text index for better text search performance
      await db.collection('customers').createIndex(
        { 
          fullName: 'text',
          phone: 'text'
        },
        { 
          name: 'customer_text_search',
          background: true,
          weights: {
            fullName: 2,
            phone: 1
          }
        }
      );
      
      console.log(`✅ Indexes created for ${dbName}.customers`);
    }
    
  } catch (error) {
    console.error('Error creating indexes:', error);
  } finally {
    await client.close();
  }
}

// Run if called directly
if (require.main === module) {
  createCustomerIndexes()
    .then(() => {
      console.log('Index creation completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Index creation failed:', error);
      process.exit(1);
    });
}

module.exports = { createCustomerIndexes }; 