# Barcode ID Migration Scripts

This directory contains scripts to add `barcodeId` fields to existing products that don't have them.

## Overview

The `barcodeId` field provides a unique identifier for each product across all stores. These scripts will:

1. Find all products without a `barcodeId`
2. Generate unique IDs using the format: `STORE_TIMESTAMP_RANDOM`
3. Update the database with the new IDs
4. Provide detailed progress reporting

## Scripts Available

### 1. `add-barcode-ids-to-products.js` (Full-featured)
- **Features**: Batch processing, error handling, progress tracking, colored output
- **Best for**: Production environments, large datasets
- **Performance**: Processes products in batches of 100

### 2. `add-barcode-ids-simple.js` (Simple)
- **Features**: Basic functionality, easy to understand
- **Best for**: Development, testing, small datasets
- **Performance**: Processes products one by one

## Prerequisites

1. **MongoDB Connection**: Ensure MongoDB is running and accessible
2. **Dependencies**: Install required packages:
   ```bash
   npm install mongodb colors
   ```
3. **Environment Variables** (optional):
   ```bash
   export MONGODB_URI="mongodb://localhost:27017"
   ```

## Usage

### Process All Stores
```bash
# Using the full-featured script
node bin/add-barcode-ids-to-products.js

# Using the simple script
node bin/add-barcode-ids-simple.js
```

### Process Specific Store
```bash
# Process only 'shoofi' store
node bin/add-barcode-ids-to-products.js shoofi

# Process only 'partner' store
node bin bin/add-barcode-ids-simple.js partner
```

## Example Output

```
🚀 Starting barcodeId migration...
Target: All stores

🔌 Connecting to MongoDB...
✅ Connected to MongoDB

🏪 Getting list of all stores...
Found 3 stores to process

📦 Processing store: shoofi
   Found 150 products without barcodeId
   ✅ Updated batch 1: 100 products
   ✅ Updated batch 2: 50 products
   ✅ Store 'shoofi' completed: 150 products updated, 0 errors

📦 Processing store: partner
   Found 75 products without barcodeId
   ✅ Updated batch 1: 75 products
   ✅ Store 'partner' completed: 75 products updated, 0 errors

📦 Processing store: delivery
   ✅ All products already have barcodeIds

🎉 Migration completed for all stores
📊 Total Summary: 225 processed, 225 updated, 0 errors

🔌 Disconnected from MongoDB
```

## Generated Barcode ID Format

Each generated ID follows this pattern:
```
STORE_TIMESTAMP_RANDOM
```

**Examples:**
- `SHO1640995200000ABC123` (Shoofi store)
- `PAR1640995200001DEF456` (Partner store)
- `DEL1640995200002GHI789` (Delivery store)

**Components:**
- `STORE`: First 3 characters of store name (uppercase)
- `TIMESTAMP`: Current timestamp in milliseconds
- `RANDOM`: 6-character random string

## Safety Features

1. **Idempotent**: Safe to run multiple times
2. **Skip Existing**: Only processes products without `barcodeId`
3. **Error Handling**: Continues processing even if individual updates fail
4. **Progress Tracking**: Shows real-time progress and statistics
5. **Batch Processing**: Processes products in manageable chunks

## Troubleshooting

### Common Issues

1. **Connection Error**:
   ```
   ❌ Migration failed: MongoNetworkError: connect ECONNREFUSED
   ```
   **Solution**: Check if MongoDB is running and accessible

2. **Permission Error**:
   ```
   ❌ Error processing store: MongoError: not authorized
   ```
   **Solution**: Check MongoDB user permissions

3. **Store Not Found**:
   ```
   ⚠️ Store database 'invalid-store' not found, skipping...
   ```
   **Solution**: Verify store name exists in the database

### Debug Mode

To see more detailed error information, you can modify the scripts to include:
```javascript
console.log('Debug info:', JSON.stringify(error, null, 2));
```

## Rollback

If you need to remove the `barcodeId` field from products:

```javascript
// In MongoDB shell or script
db.products.updateMany({}, { $unset: { barcodeId: 1 } })
```

## Performance Considerations

- **Batch Size**: Adjust `batchSize` in the full-featured script based on your database performance
- **Delay**: The 100ms delay between batches can be adjusted or removed for faster processing
- **Memory**: For very large datasets, consider processing stores sequentially

## Support

If you encounter issues:
1. Check the MongoDB connection and permissions
2. Verify the store names exist in the database
3. Check the console output for specific error messages
4. Ensure all required dependencies are installed
