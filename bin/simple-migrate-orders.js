#!/usr/bin/env node

/**
 * Simple migration script to add categoryOrders field to existing products
 * This script is compatible with older MongoDB versions
 */

const { MongoClient } = require('mongodb');

// Database configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function simpleMigrateOrders(storeName = null) {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    if (storeName) {
      // Migrate specific store
      const db = client.db(storeName);
      
      console.log(`\n🔄 Migrating store: ${storeName}`);
      await migrateStore(db, storeName);
    } else {
      // Migrate all stores
      const shoofiDb = client.db('shoofi');
      const stores = await shoofiDb.collection('stores').find({}).toArray();
      
      const storeDatabases = stores
        .filter(store => store.appName)
        .map(store => store.appName);
      
      console.log(`\n🔄 Found ${storeDatabases.length} stores to migrate:`);
      storeDatabases.forEach(db => console.log(`  - ${db}`));
      
      for (const dbName of storeDatabases) {
        const db = client.db(dbName);
        
        console.log(`\n🔄 Migrating store: ${dbName}`);
        await migrateStore(db, dbName);
      }
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

async function migrateStore(db, storeName) {
  try {
    // Get all products
    const products = await db.collection('products').find({}).toArray();
    console.log(`Found ${products.length} products to migrate`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const product of products) {
      try {
        if (product.supportedCategoryIds && product.supportedCategoryIds.length > 0) {
          // Initialize categoryOrders if it doesn't exist
          const categoryOrders = product.categoryOrders || {};
          
          // Set order for each category the product belongs to
          let hasChanges = false;
          product.supportedCategoryIds.forEach(catId => {
            if (categoryOrders[catId] === undefined) {
              categoryOrders[catId] = product.order || 0;
              hasChanges = true;
            }
          });
          
          if (hasChanges) {
            await db.collection('products').updateOne(
              { _id: product._id },
              { $set: { categoryOrders } }
            );
            migratedCount++;
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      } catch (productError) {
        console.error(`Error migrating product ${product._id}:`, productError);
      }
    }
    
    console.log(`✅ Migration completed for ${storeName}:`);
    console.log(`   - Migrated: ${migratedCount} products`);
    console.log(`   - Skipped: ${skippedCount} products`);
    
    // Validate migration
    const productsWithCategoryOrders = await db.collection('products').countDocuments({
      categoryOrders: { $exists: true }
    });
    
    const totalProducts = await db.collection('products').countDocuments({});
    
    console.log(`   - Products with categoryOrders: ${productsWithCategoryOrders}/${totalProducts}`);
    
    if (productsWithCategoryOrders > 0) {
      console.log(`✅ Migration successful for ${storeName}`);
    } else {
      console.log(`⚠️ No products were migrated for ${storeName}`);
    }
    
  } catch (error) {
    console.error(`❌ Error migrating store ${storeName}:`, error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const storeName = args[0] || null;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node bin/simple-migrate-orders.js [storeName]

Options:
  storeName    Migrate specific store only (optional)
  --help, -h   Show this help message

Examples:
  node bin/simple-migrate-orders.js                    # Migrate all stores
  node bin/simple-migrate-orders.js shoofi             # Migrate specific store
  node bin/simple-migrate-orders.js --help             # Show help
  `);
  process.exit(0);
}

// Run migration
console.log('🚀 Starting Simple Category Orders Migration');
console.log('============================================');
simpleMigrateOrders(storeName).then(() => {
  console.log('\n🎉 Migration process completed!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Migration process failed:', error);
  process.exit(1);
}); 