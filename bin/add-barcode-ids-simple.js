#!/usr/bin/env node

/**
 * Simple Migration Script: Add barcodeIds to existing products
 * 
 * This script can be run within the existing server environment
 * and uses the same database connection and functions.
 * 
 * Usage:
 * node bin/add-barcode-ids-simple.js [storeName]
 * 
 * Environment Variables:
 * - MONGODB_URI: MongoDB connection string
 * - DB_NAME: Main database name
 * - NODE_ENV: Environment (development/production)
 * 
 * Examples:
 * - MONGODB_URI="mongodb://server:27017" node bin/add-barcode-ids-simple.js
 * - export MONGODB_URI="mongodb://server:27017" && node bin/add-barcode-ids-simple.js
 */

const { MongoClient } = require('mongodb');
const colors = require('colors');
const fs = require('fs');
const path = require('path');

// Configuration - with environment variable support
const getConfig = () => {
  return {
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    DB_NAME: process.env.DB_NAME || 'shoofi',
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
};

// Function to generate unique barcode ID (same as in product.js)
const generateUniqueBarcodeId = (appName = '') => {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const storePrefix = appName ? appName.substring(0, 3).toUpperCase() : 'ST';
  return `${storePrefix}_${timestamp}_${randomStr}`;
};

// Main execution
const runMigration = async () => {
  const targetStore = process.argv[2];
  const config = getConfig();
  
  console.log(colors.cyan('🚀 Starting barcodeId migration...'));
  console.log(colors.cyan(`Target: ${targetStore ? `Store '${targetStore}'` : 'All stores'}`));
  console.log(colors.blue(`Configuration:`));
  console.log(colors.blue(`  MongoDB URI: ${config.MONGODB_URI}`));
  console.log(colors.blue(`  Database: ${config.DB_NAME}`));
  console.log(colors.blue(`  Environment: ${config.NODE_ENV}`));
  
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    console.log(colors.green('✅ Connected to MongoDB'));
    
    const db = client.db(config.DB_NAME);
    
    if (targetStore) {
      // Process single store
      await processSingleStore(client, targetStore);
    } else {
      // Process all stores
      await processAllStores(client, db);
    }
    
  } catch (error) {
    console.error(colors.red('❌ Migration failed:'), error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log(colors.blue('🔌 Disconnected from MongoDB'));
    }
  }
};

const processSingleStore = async (client, storeName) => {
  console.log(colors.blue(`\n📦 Processing store: ${storeName}`));
  
  try {
    // Get the store's database - db is the main connection, we need to switch to the store's database
    const storeDb = client.db(storeName);
    if (!storeDb) {
      console.log(colors.yellow(`⚠️  Store database '${storeName}' not found`));
      return;
    }
    
    const productsCollection = storeDb.collection('products');
    
    // Find products without barcodeId
    const productsWithoutBarcodeId = await productsCollection.find({
      $or: [
        { barcodeId: { $exists: false } },
        { barcodeId: null },
        { barcodeId: "" }
      ]
    }).toArray();
    
    console.log(colors.cyan(`   Found ${productsWithoutBarcodeId.length} products without barcodeId`));
    
    if (productsWithoutBarcodeId.length === 0) {
      console.log(colors.green('   ✅ All products already have barcodeIds'));
      return;
    }
    
    // Update products
    let updatedCount = 0;
    for (const product of productsWithoutBarcodeId) {
      try {
        const barcodeId = generateUniqueBarcodeId(storeName);
        await productsCollection.updateOne(
          { _id: product._id },
          { 
            $set: { 
              barcodeId: barcodeId,
              updatedAt: new Date()
            }
          }
        );
        updatedCount++;
        
        if (updatedCount % 10 === 0) {
          console.log(colors.green(`   ✅ Updated ${updatedCount}/${productsWithoutBarcodeId.length} products`));
        }
      } catch (error) {
        console.error(colors.red(`   ❌ Error updating product ${product._id}:`, error.message));
      }
    }
    
    console.log(colors.green(`   ✅ Completed: ${updatedCount} products updated`));
    
  } catch (error) {
    console.error(colors.red(`   ❌ Error processing store:`, error.message));
  }
};

const processAllStores = async (client, db) => {
  console.log(colors.blue('\n🏪 Getting list of stores...'));
  
  try {
    const storesCollection = db.collection('stores');
    const stores = await storesCollection.find({}, { projection: { appName: 1 } }).toArray();
    
    console.log(colors.cyan(`Found ${stores.length} stores`));
    
    for (const store of stores) {
      if (store.appName) {
        await processSingleStore(client, store.appName);
      }
    }
    
    console.log(colors.green('\n🎉 Migration completed for all stores'));
    
  } catch (error) {
    console.error(colors.red('❌ Error getting stores:', error.message));
  }
};

// Run if called directly
if (require.main === module) {
  runMigration().catch(console.error);
}

module.exports = { runMigration };
