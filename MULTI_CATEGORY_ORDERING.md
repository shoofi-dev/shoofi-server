# Multi-Category Product Ordering System

## Overview

This system allows products to have different ordering within each category they belong to. Since products can belong to multiple categories via the `supportedCategoryIds` array, each product now maintains a separate order for each category.

## Database Schema Changes

### Products Collection
```javascript
{
  _id: ObjectId,
  nameAR: String,
  nameHE: String,
  descriptionAR: String,
  descriptionHE: String,
  price: Number,
  img: Array<{ uri: String }>,
  order: Number,                    // Legacy field for backward compatibility
  categoryOrders: {                 // NEW: Category-specific ordering
    "categoryId1": 0,
    "categoryId2": 3,
    "categoryId3": 1
  },
  isInStore: Boolean,
  supportedCategoryIds: Array<String>,
  categoryId: String,               // Legacy field
  createdAt: Date,
  updatedAt: Date
}
```

### Key Changes
1. **New Field**: `categoryOrders` - Object mapping category IDs to order numbers
2. **Backward Compatibility**: `order` field maintained for existing code
3. **Automatic Migration**: Scripts to migrate existing data

## API Endpoints

### 1. Update Product Order Per Category
```http
POST /api/admin/product/update/order-per-category
Content-Type: application/json
app-name: storeName

{
  "categoryId": "categoryId",
  "productsOrder": [
    { "productId": "product1", "order": 0 },
    { "productId": "product2", "order": 1 },
    { "productId": "product3", "order": 2 }
  ]
}
```

### 2. Get Products Order for Category
```http
GET /api/admin/product/order/:categoryId
app-name: storeName

Response:
{
  "categoryId": "categoryId",
  "products": [
    {
      "_id": "product1",
      "nameAR": "Product 1",
      "nameHE": "מוצר 1",
      "img": [...],
      "order": 0,
      "categoryOrders": { "categoryId": 0 },
      "isInStore": true,
      "supportedCategoryIds": ["categoryId"],
      "displayOrder": 1,
      "categoryOrder": 0
    }
  ]
}
```

### 3. Get All Products Orders
```http
GET /api/admin/product/orders
app-name: storeName

Response:
{
  "productsByCategory": {
    "categoryId1": [
      { "productId": "product1", "categoryOrder": 0 },
      { "productId": "product2", "categoryOrder": 1 }
    ],
    "categoryId2": [
      { "productId": "product3", "categoryOrder": 0 },
      { "productId": "product1", "categoryOrder": 1 }
    ]
  }
}
```

### 4. Bulk Reorder Products
```http
POST /api/admin/product/bulk-reorder
Content-Type: application/json
app-name: storeName

{
  "categoryOrders": [
    {
      "categoryId": "categoryId1",
      "productsOrder": [
        { "productId": "product1", "order": 0 },
        { "productId": "product2", "order": 1 }
      ]
    },
    {
      "categoryId": "categoryId2",
      "productsOrder": [
        { "productId": "product3", "order": 0 },
        { "productId": "product1", "order": 1 }
      ]
    }
  ]
}
```

### 5. Reset Product Order
```http
POST /api/admin/product/reset-order/:categoryId
app-name: storeName
```

### 6. Migrate Existing Products
```http
POST /api/admin/product/migrate-orders
app-name: storeName
```

## Migration Process

### 1. Automatic Migration via API
```javascript
// Call the migration endpoint for each store
const response = await fetch('/api/admin/product/migrate-orders', {
  method: 'POST',
  headers: { 'app-name': 'storeName' }
});
```

### 2. Command Line Migration
```bash
# Migrate all stores
node bin/migrate-category-orders.js

# Migrate specific store
node bin/migrate-category-orders.js storeName

# Show help
node bin/migrate-category-orders.js --help
```

### 3. Manual Migration Script
```javascript
const { migrateCategoryOrders } = require('./utils/migrations/add-category-orders');

// For a specific database
await migrateCategoryOrders(db);
```

## Frontend Integration

### Web Admin (React)
```typescript
interface Product {
  _id: string;
  nameAR: string;
  nameHE: string;
  img: Array<{ uri: string }>;
  order: number;
  categoryOrders?: { [categoryId: string]: number };
  isInStore: boolean;
  supportedCategoryIds: string[];
  displayOrder?: number;
  categoryOrder?: number;
}

// Update product order
const updateOrder = async (categoryId: string, productsOrder: any[]) => {
  await axiosInstance.post('/admin/product/update/order-per-category', {
    categoryId,
    productsOrder
  }, {
    headers: { 'app-name': storeAppName }
  });
};
```

### React Native Apps
```typescript
interface Product {
  _id: string;
  nameAR: string;
  nameHE: string;
  img: Array<{ uri: string }>;
  order: number;
  categoryOrders?: { [categoryId: string]: number };
  isInStore: boolean;
  supportedCategoryIds: string[];
  displayOrder?: number;
  categoryOrder?: number;
}

// Update product order
const updateOrder = async (categoryId: string, productsOrder: any[]) => {
  await menuStore.updateProductsOrderPerCategory(categoryId, productsOrder);
};
```

## Menu Aggregation Updates

The menu aggregation pipeline now uses category-specific ordering:

```javascript
// In menu.js aggregation pipeline
{
  $addFields: {
    categoryOrder: {
      $ifNull: [
        { $getField: { field: "v", input: { $arrayElemAt: [{ $objectToArray: "$categoryOrders" }, 0] } } },
        "$order"
      ]
    }
  }
},
{
  $sort: { categoryOrder: 1 }
}
```

## Store Integration

### Menu Store Updates
```typescript
// Add to menuStore
updateProductsOrderPerCategory = async (categoryId: string, productsOrder: any[]) => {
  try {
    const response = await this.api.post('/admin/product/update/order-per-category', {
      categoryId,
      productsOrder
    });
    
    // Refresh menu cache
    await this.clearMenuCache();
    
    return response;
  } catch (error) {
    console.error('Error updating product order per category:', error);
    throw error;
  }
};
```

## Performance Considerations

### Database Indexes
```javascript
// Add these indexes for optimal performance
db.products.createIndex({ "categoryOrders": 1 });
db.products.createIndex({ "supportedCategoryIds": 1, "categoryOrders": 1 });
db.products.createIndex({ "isHidden": 1, "categoryOrders": 1 });
```

### Caching Strategy
- Menu cache is cleared when product orders are updated
- Category-specific caching can be implemented for better performance
- Consider implementing Redis caching for frequently accessed category orders

## Backward Compatibility

### Legacy Support
- `order` field is maintained for existing code
- Fallback to `order` field when `categoryOrders` is not available
- Gradual migration allows for smooth transition

### Migration Strategy
1. **Phase 1**: Add `categoryOrders` field to new products
2. **Phase 2**: Migrate existing products using migration script
3. **Phase 3**: Update frontend to use new ordering system
4. **Phase 4**: Remove legacy `order` field (optional)

## Error Handling

### Common Scenarios
1. **Product not in category**: Returns 400 error
2. **Invalid category ID**: Returns 400 error
3. **Database connection issues**: Returns 500 error
4. **Migration failures**: Logs error and continues with remaining products

### Validation
```javascript
// Validate input before processing
if (!categoryId || !Array.isArray(productsOrder)) {
  return res.status(400).json({ 
    message: "Invalid input: categoryId and productsOrder array required" 
  });
}

// Validate product belongs to category
const product = await db.products.findOne({
  _id: productId,
  supportedCategoryIds: { $in: [categoryId] }
});

if (!product) {
  return res.status(400).json({ 
    message: "Product not found in specified category" 
  });
}
```

## Monitoring and Logging

### Key Metrics
- Order update frequency per category
- Migration success rates
- Performance metrics for bulk operations
- Error rates and types

### Logging
```javascript
console.log(`Product order updated for category ${categoryId}: ${result.modifiedCount} products`);
console.log(`Migration completed: ${migratedCount} products processed`);
console.error('Error updating product order:', error);
```

## Testing

### Unit Tests
```javascript
describe('Product Order Management', () => {
  test('should update product order per category', async () => {
    // Test implementation
  });
  
  test('should handle multi-category products', async () => {
    // Test implementation
  });
  
  test('should migrate existing products', async () => {
    // Test implementation
  });
});
```

### Integration Tests
```javascript
describe('API Integration', () => {
  test('should update order via API', async () => {
    // Test API endpoints
  });
  
  test('should handle bulk operations', async () => {
    // Test bulk reordering
  });
});
```

## Future Enhancements

### Planned Features
1. **Order Templates**: Save and apply order templates across categories
2. **Scheduled Updates**: Schedule order changes for specific times
3. **Analytics Dashboard**: Visualize order changes and their impact
4. **A/B Testing**: Test different product orders for optimization
5. **Order History**: Track changes and allow rollback
6. **Bulk Import/Export**: CSV import/export for order management

### Performance Optimizations
1. **Lazy Loading**: Load category orders on demand
2. **Incremental Updates**: Update only changed orders
3. **Background Processing**: Process large order changes in background
4. **Smart Caching**: Intelligent cache invalidation strategies 