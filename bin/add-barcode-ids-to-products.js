#!/usr/bin/env node

/**
 * Migration Script: Add barcodeIds to existing products
 * 
 * This script iterates through all stores and adds unique barcodeIds
 * to products that don't already have them.
 * 
 * Usage:
 * node bin/add-barcode-ids-to-products.js [options] [storeName]
 * 
 * Options:
 *   --env-file=<file>    Load environment variables from file
 *   --env=<file>         Alias for --env-file
 *   --help               Show this help message
 * 
 * Examples:
 *   node bin/add-barcode-ids-to-products.js                    # Process all stores
 *   node bin/add-barcode-ids-to-products.js shoofi            # Process specific store
 *   node bin/add-barcode-ids-to-products.js --env=.env.prod   # Use environment file
 *   node bin/add-barcode-ids-to-products.js --env-file=.env.prod shoofi  # Use env file + store
 */

const { MongoClient } = require('mongodb');
const colors = require('colors');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    envFile: null,
    storeName: null,
    help: false
  };
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--env-file=')) {
      options.envFile = arg.split('=')[1];
    } else if (arg.startsWith('--env=')) {
      options.envFile = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      options.storeName = arg;
    }
  }
  
  return options;
};

// Load environment variables from file
const loadEnvFile = (envFile) => {
  try {
    const envPath = path.resolve(envFile);
    if (!fs.existsSync(envPath)) {
      console.error(colors.red(`❌ Environment file not found: ${envFile}`));
      process.exit(1);
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=');
          envVars[key.trim()] = value.trim();
          process.env[key.trim()] = value.trim();
        }
      }
    });
    
    console.log(colors.blue(`📁 Loaded environment from: ${envFile}`));
    return envVars;
  } catch (error) {
    console.error(colors.red(`❌ Error loading environment file: ${error.message}`));
    process.exit(1);
  }
};

// Show help message
const showHelp = () => {
  console.log(colors.cyan(`
🚀 Barcode ID Migration Script

Usage:
  node bin/add-barcode-ids-to-products.js [options] [storeName]

Options:
  --env-file=<file>    Load environment variables from file
  --env=<file>         Alias for --env-file
  --help               Show this help message

Examples:
  # Process all stores with default settings
  node bin/add-barcode-ids-to-products.js

  # Process specific store
  node bin/add-barcode-ids-to-products.js shoofi

  # Use environment file
  node bin/add-barcode-ids-to-products.js --env=.env.production

  # Use environment file + specific store
  node bin/add-barcode-ids-to-products.js --env=.env.production shoofi

Environment Variables:
  MONGODB_URI          MongoDB connection string (default: mongodb://localhost:27017)
  DB_NAME              Main database name (default: shoofi)
  NODE_ENV             Environment (default: development)
  LOG_LEVEL            Logging level (default: info)
  BATCH_SIZE           Batch size for processing (default: 100)
  DELAY_MS             Delay between batches in ms (default: 100)
`));
};

// Configuration
const getConfig = () => {
  return {
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    DB_NAME: process.env.DB_NAME || 'shoofi',
    NODE_ENV: process.env.NODE_ENV || 'development',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 100,
    DELAY_MS: parseInt(process.env.DELAY_MS) || 100
  };
};

// Function to generate unique barcode ID
const generateUniqueBarcodeId = (appName = '') => {
  const timestamp = Date.now(); // Current timestamp in milliseconds
  const randomStr = Math.random().toString(36).substring(2, 8); // Random 6-char string
  const storePrefix = appName ? appName.substring(0, 3).toUpperCase() : 'ST';
  
  // Format: STORE_TIMESTAMP_RANDOM (e.g., SHO1640995200000ABC123)
  return `${storePrefix}_${timestamp}_${randomStr}`;
};

// Function to process a single store
const processStore = async (db, storeName, config) => {
  console.log(colors.blue(`\n📦 Processing store: ${storeName}`));
  
  try {
    // Get the store's database
    const storeDb = db.db(storeName);
    if (!storeDb) {
      console.log(colors.yellow(`⚠️  Store database '${storeName}' not found, skipping...`));
      return { processed: 0, updated: 0, errors: 0 };
    }
    
    // Get products collection
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
      console.log(colors.green(`   ✅ All products already have barcodeIds`));
      return { processed: 0, updated: 0, errors: 0 };
    }
    
    let updatedCount = 0;
    let errorCount = 0;
    
    // Process products in batches
    const batchSize = config.BATCH_SIZE;
    for (let i = 0; i < productsWithoutBarcodeId.length; i += batchSize) {
      const batch = productsWithoutBarcodeId.slice(i, i + batchSize);
      
      const bulkOps = batch.map(product => {
        const barcodeId = generateUniqueBarcodeId(storeName);
        return {
          updateOne: {
            filter: { _id: product._id },
            update: { 
              $set: { 
                barcodeId: barcodeId,
                updatedAt: new Date()
              }
            }
          }
        };
      });
      
      try {
        const result = await productsCollection.bulkWrite(bulkOps);
        updatedCount += result.modifiedCount;
        console.log(colors.green(`   ✅ Updated batch ${Math.floor(i/batchSize) + 1}: ${result.modifiedCount} products`));
      } catch (error) {
        console.error(colors.red(`   ❌ Error updating batch ${Math.floor(i/batchSize) + 1}:`, error.message));
        errorCount += batch.length;
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, config.DELAY_MS));
    }
    
    console.log(colors.green(`   ✅ Store '${storeName}' completed: ${updatedCount} products updated, ${errorCount} errors`));
    
    return { processed: productsWithoutBarcodeId.length, updated: updatedCount, errors: errorCount };
    
  } catch (error) {
    console.error(colors.red(`   ❌ Error processing store '${storeName}':`, error.message));
    return { processed: 0, updated: 0, errors: 1 };
  }
};

// Main function
const main = async () => {
  const args = parseArgs();
  
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.envFile) {
    loadEnvFile(args.envFile);
  }

  const config = getConfig();
  const targetStore = args.storeName;
  
  console.log(colors.cyan('🚀 Starting barcodeId migration script...'));
  console.log(colors.cyan(`Target: ${targetStore ? `Store '${targetStore}'` : 'All stores'}`));
  console.log(colors.blue(`Configuration:`));
  console.log(colors.blue(`  MongoDB URI: ${config.MONGODB_URI}`));
  console.log(colors.blue(`  Database: ${config.DB_NAME}`));
  console.log(colors.blue(`  Environment: ${config.NODE_ENV}`));
  console.log(colors.blue(`  Batch Size: ${config.BATCH_SIZE}`));
  console.log(colors.blue(`  Delay: ${config.DELAY_MS}ms`));
  
  let client;
  
  try {
    // Connect to MongoDB
    console.log(colors.blue('\n🔌 Connecting to MongoDB...'));
    client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    console.log(colors.green('✅ Connected to MongoDB'));
    
    const db = client.db(config.DB_NAME);
    
    if (targetStore) {
      // Process specific store
      const result = await processStore(db, targetStore, config);
      console.log(colors.green(`\n🎉 Migration completed for store '${targetStore}'`));
      console.log(colors.green(`📊 Summary: ${result.processed} processed, ${result.updated} updated, ${result.errors} errors`));
    } else {
      // Process all stores
      console.log(colors.blue('\n🏪 Getting list of all stores...'));
      
      const storesCollection = db.collection('stores');
      const stores = await storesCollection.find({}, { projection: { appName: 1 } }).toArray();
      
      console.log(colors.cyan(`Found ${stores.length} stores to process`));
      
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalErrors = 0;
      
      // Process each store
      for (const store of stores) {
        if (store.appName) {
          const result = await processStore(db, store.appName, config);
          totalProcessed += result.processed;
          totalUpdated += result.updated;
          totalErrors += result.errors;
        }
      }
      
      console.log(colors.green('\n🎉 Migration completed for all stores'));
      console.log(colors.green(`📊 Total Summary: ${totalProcessed} processed, ${totalUpdated} updated, ${totalErrors} errors`));
    }
    
  } catch (error) {
    console.error(colors.red('\n❌ Migration failed:'), error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log(colors.blue('\n🔌 Disconnected from MongoDB'));
    }
  }
};

// Handle script execution
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { processStore, generateUniqueBarcodeId };
