# Migration Fix Guide - MongoDB Compatibility Issue

## Problem
You're getting the error `Unrecognized expression '$getField'` because your MongoDB version doesn't support this operator.

## Solution Steps

### Step 1: Fix the Current Menu Route
The current `shoofi-server/routes/menu.js` has been updated to use simple `order` sorting instead of the complex `categoryOrders` logic. This will work immediately without migration.

### Step 2: Run the Simple Migration
Use the simpler migration script that's compatible with older MongoDB versions:

```bash
# Navigate to server directory
cd shoofi-server

# Run the simple migration for all stores
node bin/simple-migrate-orders.js

# Or run for a specific store
node bin/simple-migrate-orders.js storeName
```

### Step 3: After Migration - Update Menu Route
Once the migration is complete, you can optionally update the menu route to use the new `categoryOrders` field. Replace the current `shoofi-server/routes/menu.js` with the compatible version:

```bash
# Backup current menu route
cp shoofi-server/routes/menu.js shoofi-server/routes/menu-backup.js

# Use the compatible version
cp shoofi-server/routes/menu-compatible.js shoofi-server/routes/menu.js
```

## Alternative: Manual Migration

If you prefer to migrate manually, you can run these MongoDB commands:

### 1. Check Current Products
```javascript
// Connect to your database
use your-database-name

// Check if any products have categoryOrders
db.products.findOne({categoryOrders: {$exists: true}})

// Count products that need migration
db.products.countDocuments({supportedCategoryIds: {$exists: true, $ne: []}})
```

### 2. Add categoryOrders Field
```javascript
// Add categoryOrders field to all products
db.products.updateMany(
  {supportedCategoryIds: {$exists: true, $ne: []}},
  [
    {
      $set: {
        categoryOrders: {
          $reduce: {
            input: "$supportedCategoryIds",
            initialValue: {},
            in: {
              $mergeObjects: [
                "$$value",
                { "$$this": "$order" }
              ]
            }
          }
        }
      }
    }
  ]
)
```

### 3. Verify Migration
```javascript
// Check migration results
db.products.countDocuments({categoryOrders: {$exists: true}})
db.products.countDocuments({})

// Sample a product to verify structure
db.products.findOne({categoryOrders: {$exists: true}})
```

## Testing the Fix

### 1. Test Menu API
```bash
# Test the menu endpoint
curl -X GET "http://localhost:3000/api/menu" \
  -H "app-name: yourStoreName"
```

### 2. Test Product Order API
```bash
# Test getting products order
curl -X GET "http://localhost:3000/api/admin/product/order/categoryId" \
  -H "app-name: yourStoreName"
```

### 3. Test Order Update
```bash
# Test updating product order
curl -X POST "http://localhost:3000/api/admin/product/update/order-per-category" \
  -H "Content-Type: application/json" \
  -H "app-name: yourStoreName" \
  -d '{
    "categoryId": "categoryId",
    "productsOrder": [
      {"productId": "product1", "order": 0},
      {"productId": "product2", "order": 1}
    ]
  }'
```

## Troubleshooting

### If Migration Fails
```bash
# Check MongoDB connection
mongo --eval "db.runCommand('ping')"

# Check database exists
mongo --eval "show dbs"

# Check collections
mongo your-database-name --eval "show collections"

# Check product structure
mongo your-database-name --eval "db.products.findOne()"
```

### If Menu Still Doesn't Work
```bash
# Clear menu cache
curl -X POST "http://localhost:3000/api/menu/clear-cache" \
  -H "app-name: yourStoreName"

# Check server logs for errors
tail -f shoofi-server/logs/combined.log
```

### If Products Don't Show Correct Order
1. Verify the `order` field exists in products
2. Check if products have `supportedCategoryIds`
3. Ensure products are not hidden (`isHidden: false`)

## Rollback Plan

If something goes wrong:

### 1. Rollback Menu Route
```bash
# Restore original menu route
cp shoofi-server/routes/menu-backup.js shoofi-server/routes/menu.js
```

### 2. Remove categoryOrders Field
```javascript
// Remove categoryOrders field from all products
db.products.updateMany(
  {},
  {$unset: {categoryOrders: ""}}
)
```

### 3. Restart Server
```bash
# Restart your Node.js server
pm2 restart your-app-name
# or
npm start
```

## Verification Checklist

After completing the migration:

- [ ] Menu API returns products in correct order
- [ ] Product order management works in admin panel
- [ ] Drag-and-drop reordering functions correctly
- [ ] Products appear in correct order in mobile apps
- [ ] No errors in server logs
- [ ] Cache is working properly

## Next Steps

Once the migration is successful:

1. **Test thoroughly** - Verify all functionality works as expected
2. **Monitor performance** - Check if there are any performance impacts
3. **Update documentation** - Update any relevant documentation
4. **Train users** - Show users how to use the new ordering system

## Support

If you encounter any issues:

1. Check the server logs for detailed error messages
2. Verify your MongoDB version: `mongo --version`
3. Test with a small subset of data first
4. Use the rollback plan if needed

The system is designed to be backward compatible, so even if the migration fails, your existing functionality should continue to work. 