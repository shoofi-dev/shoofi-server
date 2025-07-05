# Payment Infrastructure Documentation

## Overview

This document describes the comprehensive payment infrastructure implemented for the Wolt-like company with multiple applications: partners (shoofi-partner), drivers (shoofi-shoofir), admin web (shoofi-delivery-web), and server (shoofi-server).

## Architecture

### Backend (shoofi-server)
- **Payment Routes**: `/routes/payments.js` - Complete payment management APIs
- **Database**: MongoDB with separate collections for orders and deliveries
- **Commission Structure**: 
  - Partners: 15% commission on order total
  - Drivers: 20% commission on delivery fees

### Frontend Applications
- **Partner App**: Payment dashboard for restaurant/store owners
- **Driver App**: Payment dashboard for delivery drivers
- **Admin Web**: Comprehensive payment management and analytics

## API Endpoints

### Partner Payment APIs
```
POST /api/payments/partner/summary
POST /api/payments/partner/details
```

### Driver Payment APIs
```
POST /api/payments/driver/summary
POST /api/payments/driver/details
```

### Admin Payment APIs
```
POST /api/payments/admin/overview
POST /api/payments/admin/partners
POST /api/payments/admin/drivers
POST /api/payments/admin/analytics
```

## Features

### 1. Partner Payment Dashboard (shoofi-partner)

**Location**: `/screens/admin/payments/index.tsx`

**Features**:
- Payment summary cards (total orders, revenue, commission, earnings)
- Daily earnings chart with interactive bars
- Period selector (day/week/month)
- Detailed payment table with pagination
- Real-time data refresh
- Arabic RTL support

**Navigation**: Integrated into admin dashboard with "payments" menu item

### 2. Driver Payment Dashboard (shoofi-shoofir)

**Location**: `/screens/admin/payments/index.tsx`

**Features**:
- Delivery earnings summary (total deliveries, fees, commission, earnings)
- Daily earnings visualization
- Period filtering (day/week/month)
- Detailed delivery table
- Pull-to-refresh functionality
- Mobile-optimized interface

**Navigation**: Accessible via "driver-payments" route from driver dashboard

### 3. Admin Web Payment Management (shoofi-delivery-web)

**Location**: `/views/admin/PaymentManagement.js`

**Features**:
- **Overview Cards**: Total revenue, orders, deliveries, net profit
- **Revenue Charts**: Line charts showing revenue trends
- **Commission Analysis**: Bar charts for commission breakdown
- **Revenue Distribution**: Doughnut chart showing revenue sources
- **Partner Payments Table**: Detailed partner earnings
- **Driver Payments Table**: Driver performance and earnings
- **Analytics**: Advanced reporting and insights
- **Date Range Filtering**: Custom date range selection
- **Export Capabilities**: Data export functionality

**Navigation**: Accessible via `/admin/payments` route

## Data Models

### Partner Payment Summary
```typescript
interface PaymentSummary {
  totalOrders: number;
  totalRevenue: number;
  totalCommission: number;
  partnerEarnings: number;
  period: string;
  dateRange: {
    start: string;
    end: string;
  };
}
```

### Driver Payment Summary
```typescript
interface PaymentSummary {
  totalDeliveries: number;
  totalDeliveryFees: number;
  totalCommission: number;
  totalEarnings: number;
  period: string;
  dateRange: {
    start: string;
    end: string;
  };
}
```

### Daily Data
```typescript
interface DailyData {
  date: string;
  orders/deliveries: number;
  revenue/fees: number;
  commission: number;
  earnings: number;
}
```

## Commission Structure

### Partner Commission (15%)
- Applied to total order value
- Excludes canceled orders
- Calculated per order and aggregated

### Driver Commission (20%)
- Applied to delivery fees
- Based on completed deliveries only
- Distance and time-based calculations

## Payment Calculations

### Partner Earnings
```
Partner Earnings = Order Total - (Order Total × 0.15)
```

### Driver Earnings
```
Driver Earnings = Delivery Fee - (Delivery Fee × 0.20)
```

## Security Features

- **Authentication**: All payment APIs require valid user authentication
- **Authorization**: Role-based access control
- **Data Validation**: Input validation on all endpoints
- **Rate Limiting**: API rate limiting for payment endpoints
- **Audit Logging**: Payment transaction logging

## Best Practices Implemented

### 1. Performance Optimization
- **Pagination**: Large datasets are paginated (20 items per page)
- **Caching**: Frequently accessed data is cached
- **Database Indexing**: Optimized queries with proper indexing
- **Lazy Loading**: Components load data only when needed

### 2. User Experience
- **Real-time Updates**: Live data refresh capabilities
- **Loading States**: Proper loading indicators
- **Error Handling**: Comprehensive error messages
- **Responsive Design**: Mobile-first approach
- **Accessibility**: RTL support and screen reader compatibility

### 3. Data Management
- **Period Filtering**: Day/week/month views
- **Date Range Selection**: Custom date ranges
- **Export Functionality**: Data export capabilities
- **Search and Filter**: Advanced filtering options

### 4. Analytics and Reporting
- **Visual Charts**: Multiple chart types (line, bar, doughnut)
- **Trend Analysis**: Historical data comparison
- **Performance Metrics**: KPI tracking
- **Custom Reports**: Flexible reporting system

## Navigation Integration

### Partner App
```typescript
// MainStackNavigator.tsx
<Stack.Screen name="payments" component={PaymentDashboard} />

// Dashboard integration
case "payments":
  navigation.navigate("payments");
  break;
```

### Driver App
```typescript
// MainStackNavigator.tsx
<Stack.Screen name="driver-payments" component={DriverPaymentDashboard} />

// Dashboard integration
case "payments":
  navigation.navigate("driver-payments");
  break;
```

### Admin Web
```typescript
// index.tsx routing
<Route path="/admin/payments" element={<PaymentManagement />} />
```

## API Usage Examples

### Get Partner Payment Summary
```javascript
const response = await axiosInstance.post('/api/payments/partner/summary', {
  partnerId: 'partner_id_here',
  period: 'month', // 'day', 'week', 'month'
}, {
  headers: {
    'app-name': 'shoofi-app',
  },
});
```

### Get Driver Payment Summary
```javascript
const response = await axiosInstance.post('/api/payments/driver/summary', {
  driverId: 'driver_id_here',
  period: 'month',
}, {
  headers: {
    'app-name': 'delivery-company',
  },
});
```

### Get Admin Payment Overview
```javascript
const response = await axiosInstance.post('/api/payments/admin/overview', {
  period: 'month',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
});
```

## Error Handling

### Common Error Responses
```javascript
// 400 Bad Request
{
  "message": "Partner ID is required"
}

// 500 Internal Server Error
{
  "message": "Error getting payment summary"
}
```

### Error Handling in Frontend
```javascript
try {
  const response = await fetchPaymentData();
  // Handle success
} catch (error) {
  console.error('Error fetching payment data:', error);
  // Show user-friendly error message
}
```

## Testing

### API Testing
- Unit tests for payment calculations
- Integration tests for payment flows
- Performance tests for large datasets

### Frontend Testing
- Component testing for payment dashboards
- E2E testing for payment workflows
- Accessibility testing

## Deployment

### Environment Variables
```bash
# Database
DB_CONNECTION_STRING=mongodb://localhost:27017/shoofi

# Payment Gateway (if applicable)
PAYMENT_GATEWAY_API_KEY=your_api_key

# App Configuration
NODE_ENV=production
```

### Build Process
```bash
# Install dependencies
npm install

# Build applications
npm run build

# Start server
npm start
```

## Monitoring and Analytics

### Key Metrics
- Total revenue per period
- Commission calculations accuracy
- Payment processing times
- User engagement with payment dashboards

### Logging
- Payment transaction logs
- Error logging and alerting
- Performance monitoring
- User activity tracking

## Future Enhancements

### Planned Features
1. **Real-time Notifications**: Payment status updates
2. **Advanced Analytics**: Machine learning insights
3. **Multi-currency Support**: International payment support
4. **Payment Scheduling**: Automated payment processing
5. **Tax Integration**: Tax calculation and reporting
6. **Invoice Generation**: Automated invoice creation
7. **Payment Disputes**: Dispute resolution system
8. **Mobile Payments**: In-app payment processing

### Technical Improvements
1. **Microservices Architecture**: Service decomposition
2. **Event-driven Architecture**: Real-time updates
3. **GraphQL API**: Flexible data querying
4. **WebSocket Integration**: Real-time communication
5. **Progressive Web App**: Offline capabilities

## Support and Maintenance

### Documentation
- API documentation with examples
- User guides for each application
- Troubleshooting guides
- FAQ section

### Support Channels
- Technical support for developers
- User support for partners and drivers
- Admin support for system administrators

### Maintenance Schedule
- Regular security updates
- Performance optimizations
- Feature updates and enhancements
- Database maintenance and backups

## Conclusion

This payment infrastructure provides a comprehensive solution for managing payments across all applications in the Wolt-like ecosystem. It includes robust APIs, intuitive user interfaces, advanced analytics, and follows industry best practices for security and performance.

The system is designed to scale with business growth and can be easily extended with additional features and integrations as needed. 