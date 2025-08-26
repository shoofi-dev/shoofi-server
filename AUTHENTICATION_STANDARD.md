# Authentication Standard for ShooFi Server

## Overview

This document outlines the **unified authentication approach** for all ShooFi server routes. **All routes now use the same authentication format** - no more splitting between admin and non-admin routes.

## Authentication Method: JWT with Bearer Token

**Header Format (Standardized for ALL routes):**
```
Authorization: Bearer <jwt_token>
```

**App Type Header:**
```
app-type: shoofi-admin | shoofi-app | shoofi-partner | shoofi-shoofir
```

**User Property:** `req.auth`

## Key Principle: Consistency Across All Routes

✅ **All routes use `Bearer` token format**  
✅ **No more `Token` vs `Bearer` splitting**  
✅ **Unified authentication middleware**  
✅ **Consistent user property (`req.auth`)**  

## Standardized User Object

All authenticated routes now use `req.auth` with the following structure:

```javascript
req.auth = {
  id: "user_id",           // User ID from JWT or session
  email: "user@email.com", // User email (for admin users)
  name: "User Name",       // User display name
  isAdmin: true,           // Admin flag (for admin routes)
  roles: ["admin", "manager"], // Admin roles (for admin routes)
  appType: "shoofi-admin"  // App type for context
}
```

## Route Authentication Patterns

### Protected Routes (All Types)

```javascript
// Use auth.required for ALL protected routes - no exceptions
router.get("/api/protected", auth.required, async (req, res) => {
  const userId = req.auth.id;  // ✅ Consistent across ALL routes
  // ... route logic
});

// Admin routes use the SAME pattern
router.post("/api/admin/users", 
  auth.required, 
  checkAdminRole(["admin"]), 
  async (req, res) => {
    const adminUser = req.auth;  // ✅ Same user object format
    // ... route logic
  }
);

// Customer routes use the SAME pattern
router.get("/api/customer/details", auth.required, async (req, res) => {
  const customerId = req.auth.id;  // ✅ Same user object format
  // ... route logic
});
```

### Optional Authentication

```javascript
// Use auth.optional for routes that work with or without auth
router.get("/api/public", auth.optional, async (req, res) => {
  if (req.auth) {
    // User is authenticated - same format for all users
    const userId = req.auth.id;
  }
  // ... route logic for both authenticated and anonymous users
});
```

## Route Authentication Requirements

### Public Routes (No Authentication Required)
These routes must remain public for functionality:
- **Login routes** - Users need to authenticate first
- **Password reset routes** - Users need to reset password when locked out
- **Registration routes** - New users need to create accounts
- **Public API endpoints** - Menu, store info, etc.

### Protected Routes (Authentication Required)
These routes require valid authentication:
- **User management** - CRUD operations on user data
- **Admin operations** - Administrative functions
- **Personal data access** - User's own information
- **Sensitive operations** - Payment, orders, etc.

### Example Route Protection
```javascript
// Public route (no auth required)
router.post("/api/admin/users/login", async (req, res) => {
  // Login logic - no auth.required needed
});

// Protected route (auth required)
router.post("/api/admin/users/logout", auth.required, async (req, res) => {
  // Logout logic - requires valid authentication
});

// Protected route with role checking
router.get("/api/admin/users", auth.required, checkAdminRole(["admin"]), async (req, res) => {
  // Admin-only user listing
});
```

## What Was Fixed

### Before (Inconsistent):
```typescript
// ❌ Different formats for different routes
if (config.url?.includes('admin/')) {
  config.headers["Authorization"] = "Bearer " + token;  // Admin routes
} else {
  config.headers["Authorization"] = "Token " + token;   // Other routes
}
```

### After (Standardized):
```typescript
// ✅ Same format for ALL routes
config.headers["Authorization"] = "Bearer " + token;  // All routes
```

## Migration Completed

The following files have been updated to use standardized authentication:

✅ **shoofi-server/routes/auth.js** - JWT userProperty standardized  
✅ **shoofi-server/routes/shoofi-admin-users.js** - req.payload → req.auth  
✅ **shoofi-server/utils/auth-service.js** - Token → Bearer format  
✅ **shoofi-delivery-web** - All routes use Bearer  
✅ **shoofi-app** - All routes use Bearer  
✅ **shoofi-partner** - All routes use Bearer  
✅ **shoofi-shoofir** - All routes use Bearer  

## App Type Specific Behavior

### shoofi-admin
- Uses `adminAuthService.verifyAccessToken()`
- Verifies against `shoofiAdminUsers` collection
- Requires valid roles
- **Uses Bearer token format**

### shoofi-app / shoofi-partner
- Uses JWT with "secret" key
- Verifies against `customers` or `storeUsers` collection
- Checks token matches stored token
- **Uses Bearer token format**

### shoofi-shoofir
- Uses JWT with "secret" key
- Verifies against `delivery-company.customers` collection
- Checks token matches stored token
- **Uses Bearer token format**

## Security Considerations

1. **Token Expiration:** JWT tokens have expiration times
2. **Role-Based Access:** Admin routes check user roles
3. **App Type Validation:** Routes validate app-type header
4. **Database Verification:** Tokens are verified against database state
5. **Consistent Format:** All routes use the same authentication method

## Error Handling

### Authentication Errors
```javascript
// 401 Unauthorized
res.status(401).json({ message: "Authentication required" });

// 403 Forbidden (insufficient permissions)
res.status(403).json({ 
  message: "Insufficient permissions. Required roles: admin, manager" 
});
```

### Token Verification Errors
```javascript
try {
  // Token verification logic
} catch (error) {
  console.log("Token verification error:", error);
  return res.status(401).json({ message: "Invalid token" });
}
```

## 401 Unauthorized Error Handling

### Client-Side Behavior
When a 401 error occurs, clients should automatically:

1. **Clear Authentication Data**
   - Remove stored tokens
   - Clear user data
   - Clear any cached authentication state

2. **Logout User**
   - Redirect to login page
   - Show appropriate message
   - Prevent further authenticated requests

3. **Handle Token Refresh** (if applicable)
   - Try to refresh expired tokens
   - Retry original request with new token
   - Fall back to logout if refresh fails

### Implementation Example
```typescript
// Response interceptor for 401 handling
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Clear all authentication data
      await AsyncStorage.removeItem('@storage_userToken');
      await AsyncStorage.removeItem('@storage_userData');
      
      // Redirect to login
      window.location.href = '/login';
      
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);
```

### Security Benefits
- **Prevents stale authentication** - Users can't continue with expired tokens
- **Automatic cleanup** - No manual logout required
- **Consistent behavior** - Same logout flow across all apps
- **User experience** - Clear feedback when session expires

## Testing Authentication

### Test JWT Token (All Routes)
```bash
# Test admin routes
curl -H "Authorization: Bearer <your_jwt_token>" \
     -H "app-type: shoofi-admin" \
     http://localhost:1111/api/admin/users

# Test customer routes (SAME format)
curl -H "Authorization: Bearer <your_jwt_token>" \
     -H "app-type: shoofi-app" \
     http://localhost:1111/api/customer/details

# Test partner routes (SAME format)
curl -H "Authorization: Bearer <your_jwt_token>" \
     -H "app-type: shoofi-partner" \
     http://localhost:1111/api/partner/stores
```

### Test Session Authentication (Legacy Admin Routes)
```bash
curl -H "Cookie: connect.sid=<session_id>" \
     http://localhost:1111/admin/dashboard
```

## Best Practices

1. **Always use `auth.required`** for protected routes
2. **Use `req.auth` consistently** across all routes
3. **Include `app-type` header** in all requests
4. **Use Bearer token format** for ALL routes
5. **Check roles** for admin operations
6. **Handle authentication errors** gracefully
7. **Log authentication failures** for security monitoring

## Troubleshooting

### Common Issues

1. **"Authentication required" error**
   - Check if Authorization header is present
   - Verify token format: `Bearer <token>` (for ALL routes)
   - Ensure app-type header is set correctly

2. **"Insufficient permissions" error**
   - Verify user has required roles
   - Check if user is active in database

3. **Token verification failures**
   - Check token expiration
   - Verify token signature
   - Ensure user still exists in database

### Debug Mode

Enable debug logging by setting environment variable:
```bash
DEBUG=auth:*
```

This will log detailed authentication flow information.

## Summary

🎯 **All routes now use the same authentication format**  
🔒 **Bearer token authentication for every endpoint**  
📱 **Consistent across all mobile apps and web clients**  
🔄 **No more conditional authentication logic**  
✅ **Standardized user object (`req.auth`) across all routes**
