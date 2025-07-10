# Product Order Management Infrastructure

## Overview

This infrastructure provides comprehensive product order management per category across all platforms (Web Admin, React Native Apps). It allows administrators to easily reorder products within categories using drag-and-drop functionality and provides various management features.

## Features

### Core Features
- **Drag & Drop Reordering**: Intuitive drag-and-drop interface for reordering products
- **Per-Category Management**: Manage product order independently for each category
- **Multi-Platform Support**: Works on Web Admin and React Native apps
- **Real-time Updates**: Changes are immediately reflected across all platforms
- **Search & Filter**: Find products quickly within categories
- **Bulk Operations**: Reset order or bulk reorder across multiple categories
- **Visual Status Indicators**: Clear visual feedback for product availability

### Advanced Features
- **Cache Management**: Automatic menu cache clearing after order changes
- **Search Index Updates**: Automatic search index updates for better performance
- **Error Handling**: Comprehensive error handling and user feedback
- **Responsive Design**: Works on all screen sizes
- **RTL Support**: Full right-to-left language support (Arabic/Hebrew)

## Architecture

### Backend (Node.js/Express)

#### Enhanced API Endpoints

1. **GET `/api/admin/product/order/:categoryId`**
   - Fetches products with their order for a specific category
   - Returns products sorted by order
   - Includes display order numbers

2. **POST `/api/admin/product/update/order-per-category`**
   - Updates product order for a specific category
   - Uses bulk operations for better performance
   - Validates input and handles errors

3. **POST `/api/admin/product/bulk-reorder`**
   - Bulk reorder products across multiple categories
   - Efficient batch processing
   - Atomic operations

4. **POST `/api/admin/product/reset-order/:categoryId`**
   - Resets product order to default (by creation date)
   - Useful for reverting changes

5. **Enhanced POST `/api/admin/product/update/order`** (Legacy)
   - Improved version of existing endpoint
   - Better error handling and performance

#### Key Improvements
- **Bulk Operations**: Uses MongoDB bulkWrite for better performance
- **Cache Management**: Automatic menu cache clearing
- **Input Validation**: Comprehensive validation of all inputs
- **Error Handling**: Detailed error messages and logging
- **Search Index Updates**: Automatic search index maintenance

### Frontend Components

#### Web Admin (React/TypeScript)

**ProductOrderManager.tsx**
- Modern drag-and-drop interface using `react-beautiful-dnd`
- Real-time search and filtering
- Visual status indicators
- Responsive design with RTL support
- Comprehensive error handling

**Features:**
- Store and category selection
- Drag-and-drop reordering
- Search functionality
- Reset and bulk operations
- Visual feedback for product status
- Instructions and help text

#### React Native Apps

**ProductOrderManager.tsx**
- Native drag-and-drop using `react-native-draggable-flatlist`
- Optimized for mobile performance
- Touch-friendly interface
- Offline-capable with sync

**Features:**
- Category selection with horizontal scroll
- Product search and filtering
- Visual order indicators
- Status indicators (in-store/not in-store)
- Save and reset functionality

## API Reference

### Request/Response Formats

#### Get Products Order
```typescript
// GET /api/admin/product/order/:categoryId
// Headers: { 'app-name': string }

Response:
{
  categoryId: string;
  products: Array<{
    _id: string;
    nameAR: string;
    nameHE: string;
    img: Array<{ uri: string }>;
    order: number;
    isInStore: boolean;
    supportedCategoryIds: string[];
    displayOrder: number;
  }>;
}
```

#### Update Product Order Per Category
```typescript
// POST /api/admin/product/update/order-per-category
// Headers: { 'app-name': string }

Request:
{
  categoryId: string;
  productsOrder: Array<{
    productId: string;
    order: number;
  }>;
}

Response:
{
  message: string;
  updatedCount: number;
}
```

#### Bulk Reorder
```typescript
// POST /api/admin/product/bulk-reorder
// Headers: { 'app-name': string }

Request:
{
  categoryOrders: Array<{
    categoryId: string;
    productsOrder: Array<{
      productId: string;
      order: number;
    }>;
  }>;
}

Response:
{
  message: string;
  updatedCount: number;
}
```

#### Reset Order
```typescript
// POST /api/admin/product/reset-order/:categoryId
// Headers: { 'app-name': string }

Response:
{
  message: string;
  resetCount: number;
}
```

## Usage Examples

### Web Admin Usage

1. **Navigate to Product Order Manager**
   ```
   /admin/product-order
   /admin/product-order/{storeName}
   /admin/product-order/{storeName}/{categoryId}
   ```

2. **Select Store and Category**
   - Use dropdown to select store
   - Choose category from list

3. **Reorder Products**
   - Drag products to desired positions
   - Use search to find specific products
   - Click "Save" to persist changes

4. **Bulk Operations**
   - Click "Reset Order" to revert to default order
   - Click "Reorder All" for bulk operations

### React Native Usage

1. **Access Product Order Manager**
   - Navigate to admin section
   - Select "Product Order Management"

2. **Category Selection**
   - Scroll horizontally through categories
   - Tap to select category

3. **Product Reordering**
   - Long press and drag to reorder
   - Use search bar to filter products
   - Tap "Save Order" to persist changes

## Database Schema

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
  order: Number,           // Order within category
  isInStore: Boolean,
  supportedCategoryIds: Array<String>,
  categoryId: String,      // Legacy field
  createdAt: Date,
  updatedAt: Date
}
```

### Categories Collection
```javascript
{
  _id: ObjectId,
  nameAR: String,
  nameHE: String,
  order: Number,           // Category order
  img: String,
  isHidden: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

## Performance Considerations

### Backend Optimizations
- **Bulk Operations**: Uses MongoDB bulkWrite for efficient updates
- **Indexing**: Proper indexes on `order`, `supportedCategoryIds`, `isHidden`
- **Caching**: Menu cache management for faster responses
- **Connection Pooling**: Efficient database connection management

### Frontend Optimizations
- **Virtual Scrolling**: For large product lists
- **Debounced Search**: Prevents excessive API calls
- **Optimistic Updates**: Immediate UI feedback
- **Image Caching**: Efficient image loading and caching

## Security Considerations

### Input Validation
- Validate all input parameters
- Sanitize category IDs and product IDs
- Check user permissions for store access

### Rate Limiting
- Implement rate limiting on order update endpoints
- Prevent abuse of bulk operations

### Error Handling
- Comprehensive error logging
- User-friendly error messages
- Graceful degradation on failures

## Monitoring and Logging

### Key Metrics
- Order update frequency
- Bulk operation usage
- Error rates
- Performance metrics

### Logging
- All order changes logged
- Error details captured
- User actions tracked

## Future Enhancements

### Planned Features
1. **Order Templates**: Save and apply order templates
2. **Scheduled Updates**: Schedule order changes
3. **Analytics**: Order change analytics and insights
4. **A/B Testing**: Test different product orders
5. **Import/Export**: Bulk import/export order configurations

### Technical Improvements
1. **WebSocket Updates**: Real-time order updates across clients
2. **Offline Support**: Enhanced offline capabilities
3. **Performance**: Further optimization for large catalogs
4. **Accessibility**: Enhanced accessibility features

## Troubleshooting

### Common Issues

1. **Order Not Saving**
   - Check network connectivity
   - Verify user permissions
   - Check server logs for errors

2. **Drag and Drop Not Working**
   - Ensure JavaScript is enabled
   - Check for conflicting event handlers
   - Verify touch events on mobile

3. **Cache Issues**
   - Clear browser cache
   - Restart application
   - Check menu cache status

### Debug Mode
Enable debug logging for detailed troubleshooting:
```javascript
// Set debug flag
localStorage.setItem('debug', 'product-order:*');
```

## Support

For technical support or feature requests, please contact the development team or create an issue in the project repository. 