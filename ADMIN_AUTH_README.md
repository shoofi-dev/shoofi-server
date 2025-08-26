# Admin Authentication System

This document describes the new JWT-based authentication system for admin users in the Shoofi application.

## Overview

The admin authentication system has been upgraded from using a fake token to a proper JWT-based system with access and refresh tokens.

## Features

- **JWT Access Tokens**: Short-lived tokens (15 minutes) for API access
- **Unified Token System**: Single token stored in `@storage_userToken` for all app types
- **Automatic Token Refresh**: HTTP interceptor automatically refreshes expired tokens
- **Secure Logout**: Tokens are invalidated on logout
- **Role-based Access**: Token payload includes user roles for authorization

## Architecture

### Backend Components

1. **Admin Auth Service** (`utils/admin-auth-service.js`)
   - Token generation and verification
   - Refresh token management
   - Credential verification

2. **Admin Users Routes** (`routes/shoofi-admin-users.js`)
   - Login endpoint with token generation
   - Logout endpoint with token invalidation
   - Refresh token endpoint
   - Password change functionality

3. **Auth Middleware** (`routes/auth.js`)
   - Token verification for admin routes
   - Integration with existing customer authentication

### Frontend Components

1. **Admin Auth Context** (`contexts/AdminAuthContext.tsx`)
   - Token storage and management
   - Automatic token refresh
   - User session management

2. **HTTP Interceptor** (`utils/http-interceptor/index.ts`)
   - Automatic token injection for admin routes
   - Token expiration handling
   - Automatic token refresh on 401 errors

## API Endpoints

### Authentication

- `POST /api/admin/users/login` - Login with credentials
- `POST /api/admin/users/logout` - Logout and invalidate tokens
- `POST /api/admin/users/refresh-token` - Refresh access token
- `POST /api/admin/users/change-password` - Change user password

### Response Format

```json
{
  "user": {
    "_id": "user_id",
    "fullName": "User Name",
    "phoneNumber": "phone_number",
    "roles": ["admin", "manager"],
    "isFirstLogin": false
  },
  "token": "jwt_access_token",
  "message": "Login successful"
}
```

## Token Management

### Access Token
- **Lifetime**: 15 minutes
- **Purpose**: API authentication
- **Storage**: `@storage_userToken` in localStorage
- **Format**: JWT with user ID, roles, and expiration
- **Refresh**: Automatic refresh when token expires

## Security Features

1. **Token Expiration**: Short-lived access tokens minimize exposure
2. **Refresh Token Rotation**: New refresh token on each renewal
3. **Secure Storage**: Tokens stored in localStorage with automatic cleanup
4. **Automatic Logout**: Invalid refresh tokens trigger automatic logout
5. **Role Validation**: Server-side role verification on each request

## Usage Examples

### Login
```typescript
const response = await axiosInstance.post("admin/users/login", {
  phoneNumber: "phone_number",
  password: "password"
});

if (response.user && response.token) {
  login(response.user, response.token);
}
```

### Automatic Token Refresh
The system automatically handles token refresh when:
- Access token expires (401 response)
- Making authenticated requests
- Current token is still valid

### Logout
```typescript
// Frontend logout
logout();

// Backend logout (optional)
await axiosInstance.post("admin/users/logout", {
  userId: "user_id"
});
```

## Configuration

### Environment Variables
```bash
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
```

### Default Values (Development)
- `JWT_SECRET`: `shoofi-admin-secret-key-change-in-production`
- `JWT_REFRESH_SECRET`: `shoofi-admin-refresh-secret-key-change-in-production`

## Migration Notes

1. **Existing Users**: Current admin users will need to log in again to get new tokens
2. **Fake Token Removal**: The hardcoded fake token has been replaced with proper JWT validation
3. **Database Changes**: New fields added to `shoofiAdminUsers` collection:
   - `lastTokenRefresh`: Timestamp of last token refresh

## Testing

### Test Admin User Creation
```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test Admin",
    "phoneNumber": "1234567890",
    "roles": ["admin"]
  }'
```

### Test Login
```bash
curl -X POST http://localhost:3000/api/admin/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "1234567890",
    "password": "generated_password"
  }'
```

## Troubleshooting

### Common Issues

1. **Token Expired**: Check if refresh token is valid and not expired
2. **401 Errors**: Verify token format and expiration
3. **Refresh Failures**: Check database connection and user existence
4. **CORS Issues**: Ensure proper headers are set for admin routes

### Debug Mode
Enable debug logging by setting:
```bash
DEBUG=auth:*
```

## Future Enhancements

1. **Token Blacklisting**: Implement token blacklist for enhanced security
2. **Multi-device Support**: Allow multiple active sessions per user
3. **Audit Logging**: Track authentication events and token usage
4. **Rate Limiting**: Implement rate limiting for authentication endpoints
