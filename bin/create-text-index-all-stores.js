const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MAIN_DB = 'shoofi';

async function createTextIndexForAllStores() {
  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  try {
    await client.connect();
    const mainDb = client.db(MAIN_DB);
    const stores = await mainDb.collection('stores').find({ appName: { $exists: true } }).toArray();
    console.log(`Found ${stores.length} stores.`);

    for (const store of stores) {
      const dbName = store.appName;
      const db = client.db(dbName);
      const collections = await db.listCollections({ name: 'products' }).toArray();
      if (collections.length === 0) {
        console.log(`Skipping ${dbName}: no products collection.`);
        continue;
      }
      try {
        await db.collection('products').createIndex({
          nameAR: 'text',
          nameHE: 'text',
          descriptionAR: 'text',
          descriptionHE: 'text',
        });
        console.log(`Text index created for ${dbName}.products`);
      } catch (err) {
        console.error(`Failed to create index for ${dbName}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

createTextIndexForAllStores(); 