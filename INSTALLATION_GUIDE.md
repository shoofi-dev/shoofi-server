# Product Order Management - Installation Guide

## Prerequisites

- Node.js 14+ 
- MongoDB 4.4+
- React Native development environment (for mobile apps)
- React development environment (for web admin)

## Backend Dependencies

### Server Dependencies

The following dependencies are already included in your existing `package.json`:

```json
{
  "dependencies": {
    "express": "^4.17.1",
    "mongodb": "^4.0.0",
    "lodash": "^4.17.21"
  }
}
```

### Additional Dependencies (if not already installed)

```bash
# Install additional dependencies if needed
npm install --save express-rate-limit
npm install --save helmet
npm install --save cors
```

## Frontend Dependencies

### Web Admin Dependencies

```bash
# Navigate to web admin directory
cd shoofi-delivery-web

# Install required dependencies
npm install --save react-beautiful-dnd
npm install --save @types/react-beautiful-dnd
npm install --save react-toastify
npm install --save clsx
```

### React Native Dependencies

```bash
# Navigate to React Native app directory
cd shoofi-app  # or shoofi-partner, shoofi-shoofir

# Install required dependencies
npm install --save react-native-draggable-flatlist
npm install --save react-native-gesture-handler
npm install --save react-native-reanimated
```

## Configuration

### Backend Configuration

1. **Database Indexes**

Create the following indexes in your MongoDB database:

```javascript
// Products collection indexes
db.products.createIndex({ "order": 1 });
db.products.createIndex({ "supportedCategoryIds": 1 });
db.products.createIndex({ "isHidden": 1 });
db.products.createIndex({ "supportedCategoryIds": 1, "isHidden": 1 });
db.products.createIndex({ "supportedCategoryIds": 1, "order": 1 });

// Categories collection indexes
db.categories.createIndex({ "order": 1 });
db.categories.createIndex({ "isHidden": 1 });
```

2. **Environment Variables**

Add the following to your `.env` file:

```env
# Product Order Management
PRODUCT_ORDER_CACHE_TTL=3600
PRODUCT_ORDER_BULK_LIMIT=1000
PRODUCT_ORDER_RATE_LIMIT=100
```

### Frontend Configuration

1. **Web Admin Configuration**

Update your `src/consts/api.ts` to include the new endpoints:

```typescript
export const PRODUCT_ORDER_API = {
  GET_ORDER: 'admin/product/order',
  UPDATE_ORDER_PER_CATEGORY: 'admin/product/update/order-per-category',
  BULK_REORDER: 'admin/product/bulk-reorder',
  RESET_ORDER: 'admin/product/reset-order',
};
```

2. **React Native Configuration**

Update your `consts/api.js` to include the new endpoints:

```javascript
export const PRODUCT_ORDER_API = {
  GET_ORDER: 'admin/product/order',
  UPDATE_ORDER_PER_CATEGORY: 'admin/product/update/order-per-category',
  BULK_REORDER: 'admin/product/bulk-reorder',
  RESET_ORDER: 'admin/product/reset-order',
};
```

## Installation Steps

### 1. Backend Setup

```bash
# Navigate to server directory
cd shoofi-server

# Install dependencies
npm install

# Create database indexes
node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient('your-mongodb-connection-string');
client.connect().then(() => {
  const db = client.db('your-database-name');
  
  // Create indexes
  db.collection('products').createIndex({ 'order': 1 });
  db.collection('products').createIndex({ 'supportedCategoryIds': 1 });
  db.collection('products').createIndex({ 'isHidden': 1 });
  db.collection('products').createIndex({ 'supportedCategoryIds': 1, 'isHidden': 1 });
  db.collection('products').createIndex({ 'supportedCategoryIds': 1, 'order': 1 });
  
  db.collection('categories').createIndex({ 'order': 1 });
  db.collection('categories').createIndex({ 'isHidden': 1 });
  
  console.log('Indexes created successfully');
  client.close();
});
"

# Start the server
npm start
```

### 2. Web Admin Setup

```bash
# Navigate to web admin directory
cd shoofi-delivery-web

# Install dependencies
npm install

# Start development server
npm start
```

### 3. React Native Setup

```bash
# Navigate to React Native app directory
cd shoofi-app  # or shoofi-partner, shoofi-shoofir

# Install dependencies
npm install

# iOS (if applicable)
cd ios && pod install && cd ..

# Start the app
npm start
```

## Verification

### 1. Test Backend Endpoints

```bash
# Test the new endpoints
curl -X GET "http://localhost:1111/api/admin/product/order/test-category-id" \
  -H "app-name: your-store-name"

curl -X POST "http://localhost:1111/api/admin/product/update/order-per-category" \
  -H "Content-Type: application/json" \
  -H "app-name: your-store-name" \
  -d '{
    "categoryId": "test-category-id",
    "productsOrder": [
      {"productId": "product-1", "order": 0},
      {"productId": "product-2", "order": 1}
    ]
  }'
```

### 2. Test Web Admin Interface

1. Navigate to `http://localhost:3000/admin/product-order`
2. Select a store and category
3. Try dragging products to reorder them
4. Test the save functionality

### 3. Test React Native Interface

1. Open the React Native app
2. Navigate to the admin section
3. Find the product order management screen
4. Test drag-and-drop functionality

## Troubleshooting

### Common Issues

1. **Drag and Drop Not Working (Web)**
   ```bash
   # Check if react-beautiful-dnd is properly installed
   npm list react-beautiful-dnd
   
   # Reinstall if needed
   npm uninstall react-beautiful-dnd
   npm install react-beautiful-dnd
   ```

2. **Drag and Drop Not Working (React Native)**
   ```bash
   # Check if react-native-draggable-flatlist is installed
   npm list react-native-draggable-flatlist
   
   # Reinstall if needed
   npm uninstall react-native-draggable-flatlist
   npm install react-native-draggable-flatlist
   ```

3. **Database Connection Issues**
   ```bash
   # Check MongoDB connection
   mongo your-database-name --eval "db.runCommand('ping')"
   
   # Check if indexes exist
   mongo your-database-name --eval "db.products.getIndexes()"
   ```

4. **API Endpoints Not Found**
   ```bash
   # Check if routes are properly loaded
   curl -X GET "http://localhost:1111/api/menu" \
     -H "app-name: your-store-name"
   ```

### Performance Issues

1. **Slow Loading**
   - Check database indexes
   - Verify cache configuration
   - Monitor network requests

2. **Memory Issues**
   - Check for memory leaks in drag-and-drop components
   - Monitor React Native bundle size
   - Optimize image loading

## Security Considerations

1. **Rate Limiting**
   ```javascript
   // Add to your Express app
   const rateLimit = require('express-rate-limit');
   
   const orderUpdateLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100, // limit each IP to 100 requests per windowMs
     message: 'Too many order update requests'
   });
   
   app.use('/api/admin/product/update', orderUpdateLimiter);
   ```

2. **Input Validation**
   - All endpoints include input validation
   - Sanitize category and product IDs
   - Validate order numbers

3. **Authentication**
   - Ensure proper authentication middleware
   - Check user permissions for store access
   - Validate app-name headers

## Support

For additional support:

1. Check the main documentation: `PRODUCT_ORDER_MANAGEMENT.md`
2. Review the API reference in the documentation
3. Check the troubleshooting section
4. Contact the development team

## Updates

To update the system:

1. Pull the latest code
2. Run `npm install` to update dependencies
3. Check for any new configuration requirements
4. Test the functionality
5. Deploy to production

## Production Deployment

1. **Environment Variables**
   - Set production database connection
   - Configure cache settings
   - Set rate limiting values

2. **Performance Monitoring**
   - Monitor API response times
   - Check database performance
   - Monitor memory usage

3. **Backup Strategy**
   - Backup product order data
   - Test restore procedures
   - Monitor data integrity 