# Forgot Password Infrastructure

This document describes the forgot password functionality implemented for admin users in the Shoofi system.

## Overview

The forgot password system provides a secure way for admin users to reset their passwords when they forget them. It uses a multi-step verification process with SMS codes and temporary JWT tokens.

## Architecture

### Backend Routes

1. **POST** `/api/admin/users/forgot-password` - Initiates password reset
2. **POST** `/api/admin/users/verify-reset-code` - Verifies SMS reset code
3. **POST** `/api/admin/users/reset-password` - Resets password with temporary token

### Frontend Components

- **AdminLogin.tsx** - Main login component with forgot password flow
- **Forgot Password Flow** - 3-step process integrated into the login component

## Flow Diagram

```
User clicks "Forgot Password"
         ↓
   Step 1: Enter Phone Number
         ↓
   Send SMS with 6-digit code
         ↓
   Step 2: Enter Reset Code
         ↓
   Verify code & generate temp token
         ↓
   Step 3: Enter New Password
         ↓
   Reset password & redirect to login
```

## Security Features

### SMS Verification
- 6-digit numeric reset codes
- 15-minute expiry for reset codes
- Rate limiting (implemented via SMS service)

### JWT Tokens
- Temporary reset tokens valid for 10 minutes
- Separate secret key for reset tokens
- Token invalidation after use

### Data Protection
- No user existence disclosure
- Secure password hashing (bcrypt)
- Input sanitization (mongoSanitize)

## Implementation Details

### Backend Changes

#### 1. Admin Auth Service (`utils/admin-auth-service.js`)
- Added `generateTempResetToken()` function
- Added `verifyTempResetToken()` function
- Added `JWT_TEMP_RESET_SECRET` configuration
- Added `TEMP_RESET_TOKEN_EXPIRY` (10 minutes)

#### 2. Admin Users Routes (`routes/shoofi-admin-users.js`)
- **Forgot Password Route**: Sends SMS with reset code
- **Verify Reset Code Route**: Validates code and generates temp token
- **Reset Password Route**: Changes password using temp token
- **Updated Logout Route**: Works with/without authentication

#### 3. SMS Integration
- Uses existing SMS service (`utils/sms.js`)
- `getAdminUserResetCodeContent()` function for reset codes
- `getAdminUserTempPasswordContent()` function for new user passwords

### Frontend Changes

#### 1. AdminLogin Component (`src/views/admin/users/AdminLogin.tsx`)
- Added forgot password state management
- Implemented 3-step forgot password flow
- Added form validation and error handling
- Integrated with existing login/password change flows

#### 2. State Management
```typescript
// Forgot password form state
const [forgotPasswordData, setForgotPasswordData] = useState({
  phoneNumber: "",
  resetCode: "",
  newPassword: "",
  confirmPassword: ""
});

// Flow control
const [forgotPasswordStep, setForgotPasswordStep] = useState(1);
const [resetCodeSent, setResetCodeSent] = useState(false);
```

## API Endpoints

### 1. Forgot Password
```http
POST /api/admin/users/forgot-password
Content-Type: application/json

{
  "phoneNumber": "+972501234567"
}
```

**Response:**
```json
{
  "message": "If a user with this phone number exists, a reset code has been sent",
  "success": true
}
```

### 2. Verify Reset Code
```http
POST /api/admin/users/verify-reset-code
Content-Type: application/json

{
  "phoneNumber": "+972501234567",
  "resetCode": "123456"
}
```

**Response:**
```json
{
  "message": "Reset code verified successfully",
  "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "success": true
}
```

### 3. Reset Password
```http
POST /api/admin/users/reset-password
Content-Type: application/json

{
  "tempToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "newPassword": "newpassword123"
}
```

**Response:**
```json
{
  "message": "Password reset successfully",
  "success": true
}
```

## Database Schema

### Admin Users Collection
```javascript
{
  _id: ObjectId,
  fullName: String,
  phoneNumber: String,
  password: String, // hashed
  roles: Array,
  isFirstLogin: Boolean,
  resetCode: String, // 6-digit code
  resetCodeExpiry: Date, // 15 minutes from creation
  createdAt: Date,
  updatedAt: Date
}
```

## Testing

### Manual Testing
1. Start the server
2. Navigate to admin login page
3. Click "Forgot Password"
4. Enter a valid phone number
5. Check SMS for reset code
6. Enter the reset code
7. Set new password
8. Verify login with new password

### Automated Testing
Run the test script:
```bash
node test-forgot-password.js
```

## Configuration

### Environment Variables
```bash
JWT_TEMP_RESET_SECRET=your-temp-reset-secret-key
```

### SMS Configuration
Ensure SMS service is properly configured in `amazonconfigs` collection:
```javascript
{
  app: "sms4free",
  isActive: true,
  SECRET_KEY: "your-sms-api-key",
  USER: "your-sms-username",
  PASSWORD: "your-sms-password",
  SENDER_NAME: "Shoofi"
}
```

## Error Handling

### Common Error Scenarios
1. **Invalid Phone Number**: Generic success message (security)
2. **Expired Reset Code**: Clear error message
3. **Invalid Reset Code**: Clear error message
4. **Expired Temp Token**: Redirect to step 1
5. **SMS Failure**: Graceful degradation

### Error Messages (Hebrew)
- "קוד אימות שגוי או פג תוקף" - Invalid/expired reset code
- "שגיאה בשליחת קוד אימות" - SMS sending error
- "פג תוקף הקוד. נא לנסות שוב" - Expired temporary token
- "שגיאה באיפוס הסיסמה" - Password reset error

## Security Considerations

### Rate Limiting
- Consider implementing rate limiting for SMS requests
- Monitor for abuse patterns

### Token Security
- Temporary tokens have short expiry (10 minutes)
- Separate secret key for reset tokens
- Tokens are invalidated after use

### SMS Security
- Reset codes are numeric only (6 digits)
- Codes expire after 15 minutes
- No user existence disclosure

## Future Enhancements

1. **Email Fallback**: Add email-based password reset
2. **2FA Integration**: Add two-factor authentication
3. **Audit Logging**: Log all password reset attempts
4. **Rate Limiting**: Implement proper rate limiting
5. **CAPTCHA**: Add CAPTCHA for repeated attempts

## Troubleshooting

### Common Issues

1. **SMS Not Sending**
   - Check SMS service configuration
   - Verify phone number format
   - Check SMS balance

2. **Reset Code Not Working**
   - Verify code hasn't expired (15 minutes)
   - Check for leading zeros in code
   - Ensure correct phone number

3. **Temp Token Expired**
   - Token expires after 10 minutes
   - User must restart the flow

4. **Password Reset Fails**
   - Check password requirements (min 6 characters)
   - Verify temp token is valid
   - Check server logs for errors

### Debug Mode
Enable debug logging by setting environment variable:
```bash
DEBUG=admin:forgot-password
```

## Support

For issues or questions regarding the forgot password infrastructure:
1. Check server logs for error details
2. Verify SMS service configuration
3. Test with the provided test script
4. Review this documentation
5. Contact the development team
