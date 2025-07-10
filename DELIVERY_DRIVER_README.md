# Delivery Driver Infrastructure

This document describes the comprehensive delivery driver infrastructure implemented in the shoofi-app project.

## Overview

The delivery driver system provides a complete solution for managing delivery operations, including order management, driver tracking, earnings calculation, and real-time communication.

## Architecture

### Frontend (React Native)

#### Screens
- **`screens/delivery-driver/index.tsx`** - Main dashboard showing active and completed orders
- **`screens/delivery-driver/order-details.tsx`** - Detailed view of a specific order
- **`screens/delivery-driver/profile.tsx`** - Driver profile management and statistics

#### Components
- **`components/delivery-driver/DeliveryDriverHeader.tsx`** - Header component with driver info and stats
- **`components/delivery-driver/OrderCard.tsx`** - Reusable order card component
- **`components/delivery-driver/StatusBadge.tsx`** - Status indicator component

#### Store
- **`stores/delivery-driver/index.ts`** - MobX store for delivery driver state management

### Backend (Node.js)

#### API Endpoints (routes/delivery.js)

##### Order Management
- `GET /api/delivery/order/:id` - Get single order details
- `POST /api/delivery/list` - Get orders list (existing, enhanced)
- `POST /api/delivery/update` - Update order status (existing, enhanced)

##### Driver Statistics
- `POST /api/delivery/driver/stats` - Get driver performance statistics
- `POST /api/delivery/driver/earnings` - Get driver earnings report
- `POST /api/delivery/driver/schedule` - Get driver work schedule

##### Location & Availability
- `POST /api/delivery/driver/location` - Update driver location
- `POST /api/delivery/driver/availability` - Update driver availability
- `POST /api/delivery/driver/nearby-orders` - Get nearby orders for driver

##### Notifications
- `POST /api/delivery/driver/notifications` - Get driver notifications
- `POST /api/delivery/driver/notifications/read` - Mark notification as read

##### Profile Management
- `GET /api/delivery/company/employee/:id` - Get employee profile (existing)
- `POST /api/delivery/company/employee/update/:id` - Update employee profile (existing)

## Features

### 1. Order Management
- **Real-time Order Updates**: Drivers can see new orders as they come in
- **Status Tracking**: Orders progress through states: Pending → Assigned → Picked Up → Delivered
- **Order Details**: Complete order information including customer details, items, and delivery instructions
- **Action Buttons**: Quick actions for pickup, delivery, and cancellation

### 2. Driver Dashboard
- **Active Orders**: Shows currently assigned and in-progress orders
- **Completed Orders**: Historical view of delivered orders
- **Statistics**: Real-time stats including total orders, earnings, and success rate
- **Pull-to-Refresh**: Easy data refresh functionality

### 3. Profile Management
- **Personal Information**: Name, phone, email management
- **Vehicle Information**: Vehicle type, model, and license plate
- **Availability Toggle**: Online/offline status control
- **Statistics Display**: Performance metrics and earnings history

### 4. Location Services
- **GPS Tracking**: Real-time location updates
- **Nearby Orders**: Find orders within specified radius
- **Distance Calculation**: Haversine formula for accurate distance measurement

### 5. Earnings & Analytics
- **Earnings Report**: Daily, weekly, monthly earnings breakdown
- **Performance Metrics**: Success rate, average delivery time
- **Work Schedule**: Historical order data by date

### 6. Notifications
- **Push Notifications**: Real-time order assignments and updates
- **In-app Notifications**: Notification center for drivers
- **Read/Unread Status**: Track notification engagement

## Data Models

### Order Status Codes
- `'1'` - Pending (waiting for driver assignment)
- `'2'` - Assigned (assigned to driver)
- `'3'` - Picked Up (driver has collected order)
- `'0'` - Delivered (order completed successfully)
- `'-1'` - Cancelled (order cancelled)

### Driver Profile Fields
```typescript
interface DriverProfile {
  _id: string;
  fullName: string;
  phone: string;
  email?: string;
  isActive: boolean;
  companyId: string;
  companyName?: string;
  vehicleInfo?: {
    type: string;
    model: string;
    plateNumber: string;
  };
  rating?: number;
  totalDeliveries?: number;
  totalEarnings?: number;
  currentLocation?: {
    latitude: number;
    longitude: number;
  };
  isOnline?: boolean;
  isAvailable?: boolean;
  createdAt: string;
}
```

## Store Architecture

The delivery driver system uses MobX for state management, following the same pattern as other stores in the project:

### Store Structure
```typescript
class DeliveryDriverStore {
  // State
  orders: Order[] = [];
  activeOrders: Order[] = [];
  completedOrders: Order[] = [];
  profile: DriverProfile | null = null;
  stats: DriverStats | null = null;
  loading: boolean = false;
  refreshing: boolean = false;
  
  // Computed values
  get totalOrders() { return this.orders.length; }
  get activeOrdersCount() { return this.activeOrders.length; }
  get completedOrdersCount() { return this.completedOrders.length; }
  
  // Actions
  getOrders(driverId: string) { /* ... */ }
  updateOrderStatus(orderId: string, status: string) { /* ... */ }
  getProfile(driverId: string) { /* ... */ }
  updateProfile(driverId: string, profileData: Partial<DriverProfile>) { /* ... */ }
  // ... more methods
}
```

### Usage in Components
```typescript
const { deliveryDriverStore } = useContext(StoreContext);

// Access state
const orders = deliveryDriverStore.orders;
const profile = deliveryDriverStore.profile;

// Call actions
await deliveryDriverStore.getOrders(userId);
await deliveryDriverStore.updateOrderStatus(orderId, '3');
```

## API Integration

### Authentication
All API calls include the `app-name` header for multi-tenant support:
```javascript
headers: {
  'Content-Type': 'application/json',
  'app-name': 'shoofi-app',
}
```

### Error Handling
Comprehensive error handling with user-friendly messages and retry mechanisms.

### Real-time Updates
Location updates every 30 seconds when driver is online.

## Navigation

The delivery driver screens are integrated into the main navigation stack:

```typescript
// MainStackNavigator.tsx
<Stack.Screen name="delivery-driver-dashboard" component={DeliveryDriverDashboard} />
<Stack.Screen name="delivery-driver-order-details" component={DeliveryDriverOrderDetails} />
<Stack.Screen name="delivery-driver-profile" component={DeliveryDriverProfile} />
```

## Usage

### For Drivers
1. **Login**: Drivers log in with their credentials
2. **Dashboard**: View active and completed orders
3. **Order Management**: Accept, pickup, and deliver orders
4. **Profile**: Update personal and vehicle information
5. **Location**: Enable GPS for real-time tracking

### For Administrators
1. **Driver Assignment**: Assign orders to available drivers
2. **Monitoring**: Track driver locations and order progress
3. **Analytics**: View driver performance and earnings reports
4. **Communication**: Send notifications to drivers

## Security Considerations

- **Authentication**: All API calls require valid user authentication
- **Authorization**: Drivers can only access their own orders and data
- **Location Privacy**: Location data is only shared with authorized parties
- **Data Validation**: Input validation on all API endpoints

## Performance Optimizations

- **Pagination**: Large data sets are paginated for better performance
- **Caching**: Frequently accessed data is cached locally
- **Background Updates**: Location updates happen in background
- **Lazy Loading**: Components load data only when needed

## Future Enhancements

1. **Real-time Chat**: Driver-customer communication
2. **Route Optimization**: AI-powered route suggestions
3. **Payment Integration**: In-app payment processing
4. **Offline Support**: Work without internet connection
5. **Multi-language Support**: Internationalization
6. **Advanced Analytics**: Machine learning insights

## Troubleshooting

### Common Issues

1. **Location Not Updating**
   - Check GPS permissions
   - Verify internet connection
   - Restart the app

2. **Orders Not Loading**
   - Check authentication status
   - Verify API connectivity
   - Clear app cache

3. **Profile Update Fails**
   - Validate input data
   - Check network connection
   - Verify user permissions

### Debug Mode
Enable debug logging by setting `__DEV__` flag in development builds.

## Support

For technical support or feature requests, please contact the development team or create an issue in the project repository. 