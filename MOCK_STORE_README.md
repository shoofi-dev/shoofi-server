# Mock Store Functionality

This document explains how to use the mock store functionality in the Shoofi system. Mock stores allow you to create template stores that other stores can copy from, ensuring product consistency and barcode standardization across all stores.

## Overview

The mock store system provides:
1. **Template Stores**: Mark existing stores as mock stores to serve as templates
2. **Store Cloning**: Create new stores by copying configuration and products from mock stores
3. **Product Consistency**: Maintain the same product barcodes across all stores
4. **Barcode Management**: Ensure products can be identified consistently across the system
5. **Type Categorization**: Categorize mock stores by business type (e.g., supermarket)
6. **Source Control**: Control which mock store each store should use for products

## How It Works

### 1. Mock Store Creation
- An existing store can be marked as a "mock store" with a specific type
- Mock stores serve as templates for other stores of the same business type
- They contain the base product catalog with standardized barcodes

### 2. Store Cloning
- New stores can be created by copying from mock stores
- This copies:
  - Store configuration (categories, cities, general settings)
  - Product structure (but not individual product instances)
  - Store settings and preferences
  - Mock type and source information

### 3. Product Management
- Products from mock stores can be referenced when creating products in other stores
- Barcodes are preserved to maintain consistency
- Each store can customize product details (name, price, description) while keeping the same barcode
- Stores are restricted to using products only from their assigned mock store source

## New Properties

### mockType
- **Purpose**: Defines the business type of the mock store (e.g., "supermarket", "restaurant", "pharmacy")
- **Usage**: 
  - For mock stores: Specifies what type of business this template represents
  - For regular stores: Specifies what type of business this store should use for product templates
- **Values**: Currently supports "supermarket" (can be extended to other types)

### mockTypeSource
- **Purpose**: Specifies which specific mock store should be used as the source for products
- **Usage**: 
  - Only applicable to stores that are not mock stores themselves
  - Links the store to a specific mock store of the same type
  - Ensures product consistency and barcode standardization
- **Validation**: Prevents stores from using products from unauthorized mock stores

## API Endpoints

### Store Management

#### Mark Store as Mock
```http
POST /api/shoofiAdmin/store/mark-as-mock
Content-Type: application/json

{
  "storeId": "store_id_here",
  "mockType": "supermarket"
}
```

#### Create Store from Mock
```http
POST /api/shoofiAdmin/store/create-from-mock
Content-Type: application/json

{
  "mockStoreAppName": "mock_store_app_name",
  "newStoreData": {
    "appName": "new-store-name",
    "name_ar": "Store Name Arabic",
    "name_he": "Store Name Hebrew",
    "descriptionAR": "Description in Arabic",
    "descriptionHE": "Description in Hebrew",
    "business_visible": true,
    "categoryIds": ["category1", "category2"],
    "supportedCities": ["city1", "city2"],
    "hasGeneralCategories": true,
    "phone": "+1234567890",
    "address": "Store Address",
    "location": {
      "lat": 32.1145,
      "lng": 34.9718
    }
  }
}
```

#### Get Mock Stores
```http
GET /api/shoofiAdmin/store/mock-stores
```

#### Get Mock Stores by Type
```http
GET /api/shoofiAdmin/store/mock-stores/{mockType}
```

#### Get Available Mock Types
```http
GET /api/shoofiAdmin/store/mock-types
```

#### Get Mock Store Products
```http
GET /api/shoofiAdmin/store/{storeId}/mock-products
```

### Product Management

#### Create Product from Mock
```http
POST /api/product/create-from-mock
Content-Type: application/json
app-name: store_app_name

{
  "mockStoreAppName": "mock_store_app_name",
  "productData": {
    "productId": "product_id_from_mock",
    "nameAR": "Product Name Arabic",
    "nameHE": "Product Name Hebrew",
    "descriptionAR": "Description Arabic",
    "descriptionHE": "Description Hebrew",
    "price": "29.99",
    "count": "100",
    "categoryId": "category_id"
  }
}
```

#### Get Products from Mock Store
```http
GET /api/product/mock-store/{mockStoreAppName}
```

#### Update Product Barcode
```http
POST /api/product/update-barcode
Content-Type: application/json
app-name: store_app_name

{
  "productId": "product_id",
  "barcode": "new_barcode_value"
}
```

## Database Schema Changes

### Store Collection
Added fields to the `stores` collection:
```javascript
{
  // ... existing fields
  isMockStore: Boolean,        // Whether this store is a mock store
  mockStoreAppName: String,    // Reference to the original mock store appName (for copy stores)
  mockType: String,            // Type of business (e.g., "supermarket")
  mockTypeSource: String,      // Reference to the mock store appName this store should use for products
  updatedAt: Date             // Last update timestamp
}
```

### Product Collection
Added fields to the `products` collection:
```javascript
{
  // ... existing fields
  barcode: String,            // Product barcode for consistency
  mockStoreAppName: String,   // Reference to the mock store appName this product came from
  mockProductId: ObjectId,    // Reference to the original product in the mock store
  mockType: String,           // Type of business this product belongs to
  updatedAt: Date            // Last update timestamp
}
```

## Frontend Components

### Store Form
- Added checkbox to mark stores as mock stores
- Added dropdown to select mock store type (currently "supermarket")
- Added dropdown to select mock store source when creating copy stores
- Enhanced form validation for mock store creation
- Dynamic loading of available mock stores based on selected type

### Store List
- Shows store type (Mock Store, Copy Store, Regular Store)
- Displays mock type information for each store
- Added "Mark as Mock" action for regular stores
- Visual indicators for different store types and their sources

### Product Creation from Mock
- Modal component for selecting products from mock stores
- Form for customizing product details while preserving barcodes
- Barcode display and information
- Validation to ensure products come from the correct mock store source

## Usage Workflow

### 1. Create a Mock Store
1. Create or select an existing store with a good product catalog
2. Mark it as a mock store and select the business type (e.g., "supermarket")
3. Ensure all products have proper barcodes assigned

### 2. Create Stores from Mock
1. Go to "Add Store" form
2. Select the mock store type (e.g., "supermarket")
3. Choose the specific mock store to copy from
4. Fill in the new store details
5. Submit to create the new store

### 3. Add Products from Mock
1. In the new store, go to product management
2. Use "Create from Mock" functionality
3. Select products from the assigned mock store
4. Customize product details (name, price, description)
5. Barcodes are automatically preserved

## Benefits

1. **Consistency**: All stores use the same product barcodes
2. **Efficiency**: Quick store setup by copying from templates
3. **Quality**: Standardized product catalog across stores
4. **Flexibility**: Each store can customize product details while maintaining consistency
5. **Scalability**: Easy to add new stores with proven product structures
6. **Type Safety**: Stores can only use products from their designated mock store type
7. **Source Control**: Prevents unauthorized access to products from other mock stores
8. **Data Integrity**: All IDs (categories, general categories, products) are preserved as ObjectIds to maintain proper database relationships

## Best Practices

1. **Barcode Assignment**: Assign barcodes to products in mock stores before marking them as mock
2. **Type Consistency**: Use consistent mock types across your system (e.g., always use "supermarket" for grocery stores)
3. **Product Updates**: Update products in mock stores to propagate changes to copy stores
4. **Store Naming**: Use clear naming conventions for mock stores (e.g., "Supermarket Template")
5. **Regular Review**: Periodically review and update mock stores to ensure they remain current
6. **Documentation**: Keep track of which stores are copies of which mock stores and their types

## Troubleshooting

### Common Issues

1. **Barcode Conflicts**: Ensure unique barcodes across all stores
2. **Missing Mock Store**: Verify the mock store exists and is properly marked
3. **Product Not Found**: Check if the product exists in the mock store
4. **Database Access**: Ensure the mock store database is accessible
5. **Type Mismatch**: Ensure the store is trying to use products from the correct mock store type
6. **Source Mismatch**: Verify the store is using the correct mock store source
7. **ID Type Issues**: Ensure that when copying from mock stores, all IDs remain as ObjectIds (not converted to strings) to maintain database relationships

### Error Messages

- `"Invalid mock store ID or store is not marked as mock"`: The selected store is not a mock store
- `"Product with this barcode already exists"`: Barcode conflict in the current store
- `"Mock store database not accessible"`: Database connection issue
- `"This store is configured to use a different mock store source"`: Store is trying to use unauthorized mock store

## Future Enhancements

1. **Additional Mock Types**: Support for restaurant, pharmacy, electronics, etc.
2. **Bulk Operations**: Copy multiple products at once
3. **Sync Updates**: Automatically sync product changes from mock stores
4. **Version Control**: Track changes and versions of mock stores
5. **Analytics**: Monitor usage and effectiveness of mock stores
6. **Templates**: Pre-built store templates for different business types
7. **Type Inheritance**: Allow stores to inherit from multiple mock store types
8. **Product Bundling**: Create product bundles that can be copied together
