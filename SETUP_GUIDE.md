# Multi-Category Product Ordering - Setup Guide

## Quick Start

### 1. Backend Setup

#### Step 1: Update Product Routes
The enhanced product routes are already added to `shoofi-server/routes/product.js`. The new endpoints include:

- `POST /api/admin/product/update/order-per-category`
- `GET /api/admin/product/order/:categoryId`
- `GET /api/admin/product/orders`
- `POST /api/admin/product/bulk-reorder`
- `POST /api/admin/product/reset-order/:categoryId`
- `POST /api/admin/product/migrate-orders`

#### Step 2: Update Menu Aggregation
The menu aggregation in `shoofi-server/routes/menu.js` has been updated to use category-specific ordering.

#### Step 3: Run Migration
```bash
# Navigate to server directory
cd shoofi-server

# Migrate all stores
node bin/migrate-category-orders.js

# Or migrate specific store
node bin/migrate-category-orders.js storeName
```

### 2. Frontend Setup

#### Step 1: Web Admin (React)
The enhanced ProductOrderManager component is available at:
`shoofi-delivery-web/src/views/admin/ProductOrderManager.tsx`

Access it via: `/admin/product-order/:storeName/:categoryId`

#### Step 2: React Native Apps
Update the product order manager components in:
- `shoofi-app/screens/admin/product-order-manager/index.tsx`
- `shoofi-shoofir/screens/admin/product-order-manager/index.tsx`
- `shoofi-partner/screens/admin/product-order-manager/index.tsx`

### 3. Database Indexes

Run these MongoDB commands to optimize performance:

```javascript
// Connect to your database
use your-database-name

// Create indexes for optimal performance
db.products.createIndex({ "categoryOrders": 1 });
db.products.createIndex({ "supportedCategoryIds": 1, "categoryOrders": 1 });
db.products.createIndex({ "isHidden": 1, "categoryOrders": 1 });
db.products.createIndex({ 
  "supportedCategoryIds": 1, 
  "isHidden": 1, 
  "categoryOrders": 1,
  "_id": 1 
});
```

## Detailed Implementation

### Phase 1: Backend Implementation

#### 1.1 Database Schema Update
The new `categoryOrders` field is automatically added when products are updated. For existing products, run the migration:

```bash
# Run migration script
node bin/migrate-category-orders.js
```

#### 1.2 API Testing
Test the new endpoints:

```bash
# Test getting products order for a category
curl -X GET "http://localhost:3000/api/admin/product/order/categoryId" \
  -H "app-name: storeName"

# Test updating product order
curl -X POST "http://localhost:3000/api/admin/product/update/order-per-category" \
  -H "Content-Type: application/json" \
  -H "app-name: storeName" \
  -d '{
    "categoryId": "categoryId",
    "productsOrder": [
      {"productId": "product1", "order": 0},
      {"productId": "product2", "order": 1}
    ]
  }'
```

### Phase 2: Frontend Implementation

#### 2.1 Web Admin Updates
1. Navigate to the ProductOrderManager component
2. Test drag-and-drop functionality
3. Verify order updates are saved correctly
4. Test bulk operations

#### 2.2 React Native Updates
1. Update the product order manager screens
2. Test drag-and-drop on mobile devices
3. Verify order persistence across app restarts

### Phase 3: Testing and Validation

#### 3.1 Functional Testing
```javascript
// Test scenarios
1. Product belongs to single category
2. Product belongs to multiple categories
3. Reordering products within a category
4. Bulk reordering across categories
5. Migration of existing products
6. Reset order functionality
```

#### 3.2 Performance Testing
```javascript
// Test with large datasets
1. 1000+ products per category
2. Products belonging to 10+ categories
3. Concurrent order updates
4. Menu loading performance
```

## Configuration

### Environment Variables
```bash
# Database configuration
MONGODB_URI=mongodb://localhost:27017
DATABASE_PREFIX=shoofi

# Cache configuration (optional)
REDIS_URL=redis://localhost:6379
CACHE_TTL=3600
```

### Store Configuration
Each store can have its own configuration:

```javascript
// Store-specific settings
{
  "storeName": "shoofi",
  "enableCategoryOrders": true,
  "autoMigrate": true,
  "cacheEnabled": true
}
```

## Monitoring

### 1. Logs
Monitor these log entries:
```javascript
// Success logs
console.log(`Product order updated for category ${categoryId}: ${result.modifiedCount} products`);
console.log(`Migration completed: ${migratedCount} products processed`);

// Error logs
console.error('Error updating product order:', error);
console.error('Migration failed for product:', productId);
```

### 2. Metrics
Track these metrics:
- Order update frequency per category
- Migration success rates
- API response times
- Cache hit rates

### 3. Health Checks
```bash
# Check migration status
curl -X GET "http://localhost:3000/api/admin/product/migrate-status" \
  -H "app-name: storeName"

# Check cache status
curl -X GET "http://localhost:3000/api/menu/cache-stats"
```

## Troubleshooting

### Common Issues

#### 1. Migration Fails
```bash
# Check database connection
mongo --eval "db.runCommand('ping')"

# Check product collection
mongo --eval "db.products.count()"

# Run migration with verbose logging
DEBUG=migration node bin/migrate-category-orders.js
```

#### 2. Order Not Updating
```bash
# Check if product belongs to category
mongo --eval "db.products.findOne({_id: ObjectId('productId'), supportedCategoryIds: 'categoryId'})"

# Check categoryOrders field
mongo --eval "db.products.findOne({_id: ObjectId('productId')}, {categoryOrders: 1})"
```

#### 3. Menu Not Reflecting Changes
```bash
# Clear menu cache
curl -X POST "http://localhost:3000/api/menu/clear-cache" \
  -H "app-name: storeName"

# Refresh menu cache
curl -X POST "http://localhost:3000/api/menu/refresh" \
  -H "app-name: storeName"
```

### Debug Mode
Enable debug logging:

```javascript
// In your application
process.env.DEBUG = 'product-order:*';

// Or set environment variable
export DEBUG=product-order:*
```

## Rollback Plan

### If Migration Fails
```bash
# Rollback migration
node bin/migrate-category-orders.js --rollback

# Or manually remove categoryOrders field
mongo --eval "db.products.updateMany({}, {\$unset: {categoryOrders: \"\"}})"
```

### If API Changes Cause Issues
1. Revert to previous version of product routes
2. Keep legacy `order` field for backward compatibility
3. Gradually migrate to new system

## Support

### Documentation
- `MULTI_CATEGORY_ORDERING.md` - Complete system documentation
- `PRODUCT_ORDER_MANAGEMENT.md` - Original product order management docs
- `INSTALLATION_GUIDE.md` - Installation and dependency guide

### Contact
For issues or questions:
1. Check the troubleshooting section
2. Review the documentation
3. Check logs for error details
4. Test with minimal dataset first

## Next Steps

After successful implementation:

1. **Monitor Performance**: Track API response times and database performance
2. **Gather Feedback**: Collect user feedback on the new ordering system
3. **Optimize**: Implement performance improvements based on usage patterns
4. **Enhance**: Add new features like order templates and analytics
5. **Scale**: Prepare for handling larger datasets and more stores 