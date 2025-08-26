const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const { mongoSanitize } = require("../lib/common");
const smsService = require("../utils/sms");
const adminAuthService = require("../utils/admin-auth-service");
const auth = require("../routes/auth");

// Generate random password
function generatePassword() {
  const length = 8;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// Middleware to check admin roles
const checkAdminRole = (requiredRoles = ["admin"]) => {
  return (req, res, next) => {
    try {
      // Get user from JWT auth (set by auth.required middleware)
      const user = req.auth;
      
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      
      // Check if user has any of the required roles
      const hasRequiredRole = requiredRoles.some(role => 
        user.roles && user.roles.includes(role)
      );
      
      if (!hasRequiredRole) {
        return res.status(403).json({ 
          message: "Insufficient permissions. Required roles: " + requiredRoles.join(", ") 
        });
      }
      
      // Add user info to request for use in route handlers
      req.adminUser = user;
      next();
    } catch (error) {
      console.error("Role check error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
};

// Get all admin users
router.get("/api/admin/users", auth.required, checkAdminRole(["admin", "manager"]), async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { page = 1, limit = 10, search = "" } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    
    let query = {};
    
    // Add search functionality
    if (search && search.trim()) {
      query = {
        $or: [
          { fullName: { $regex: search.trim(), $options: "i" } },
          { phoneNumber: { $regex: search.trim(), $options: "i" } }
        ]
      };
    }
    
    const users = await db.shoofiAdminUsers
      .find(query)
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 })
      .toArray();
    
    const totalUsers = await db.shoofiAdminUsers.countDocuments(query);
    
    const pagination = {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalUsers / limitNum),
      totalItems: totalUsers,
      itemsPerPage: limitNum
    };
    
    res.json({
      users,
      pagination
    });
  } catch (error) {
    console.error("Error fetching admin users:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get single admin user
router.get("/api/admin/users/:id", auth.required, checkAdminRole(["admin", "manager"]), async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    const user = await db.shoofiAdminUsers.findOne({
      _id: new ObjectId(id)
    });
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json(user);
  } catch (error) {
    console.error("Error fetching admin user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create new admin user
router.post("/api/admin/users", auth.required, checkAdminRole(["admin"]), async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { fullName, phoneNumber, roles, password } = req.body;
    
    // Validate required fields
    if (!fullName || !phoneNumber || !roles) {
      return res.status(400).json({ 
        message: "Required fields: fullName, phoneNumber, roles" 
      });
    }
    
    // Validate roles array
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ message: "Roles must be a non-empty array" });
    }
    
    // Check if phone number already exists
    const existingUser = await db.shoofiAdminUsers.findOne({
      phoneNumber: mongoSanitize(phoneNumber)
    });
    
    if (existingUser) {
      return res.status(400).json({ message: "Phone number already exists" });
    }
    
    // Generate auto password if not provided
    let finalPassword = password;
    if (!password || password.trim() === '') {
      finalPassword = generatePassword();
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(finalPassword, saltRounds);
    
    const newUser = {
      fullName: mongoSanitize(fullName),
      phoneNumber: mongoSanitize(phoneNumber),
      roles: roles,
      password: hashedPassword,
      isFirstLogin: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.shoofiAdminUsers.insertOne(newUser);
    
    // Send SMS with temporary password
    try {
      const smsContent = smsService.getAdminUserTempPasswordContent(fullName, finalPassword);
      await smsService.sendSMS(phoneNumber, smsContent, req, db);
      console.log(`SMS sent successfully to ${phoneNumber} for new admin user`);
    } catch (smsError) {
      console.error("Error sending SMS for new admin user:", smsError);
      // Don't fail the user creation if SMS fails
    }
    
    // Return user without password but include generated password
    const createdUser = await db.shoofiAdminUsers.findOne({
      _id: result.insertedId
    }, { projection: { password: 0 } });
    
    res.status(201).json({
      user: createdUser,
      generatedPassword: finalPassword,
      smsSent: true
    });
  } catch (error) {
    console.error("Error creating admin user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update admin user
router.put("/api/admin/users/:id", auth.required, checkAdminRole(["admin", "manager"]), async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { id } = req.params;
    const { fullName, phoneNumber, roles, password } = req.body;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    // Validate required fields
    if (!fullName || !phoneNumber || !roles) {
      return res.status(400).json({ 
        message: "Required fields: fullName, phoneNumber, roles" 
      });
    }
    
    // Validate roles array
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ message: "Roles must be a non-empty array" });
    }
    
    // Check if phone number already exists for other users
    const existingUser = await db.shoofiAdminUsers.findOne({
      phoneNumber: mongoSanitize(phoneNumber),
      _id: { $ne: new ObjectId(id) }
    });
    
    if (existingUser) {
      return res.status(400).json({ message: "Phone number already exists" });
    }
    
    const updateData = {
      fullName: mongoSanitize(fullName),
      phoneNumber: mongoSanitize(phoneNumber),
      roles: roles,
      updatedAt: new Date()
    };
    
    // Only update password if provided
    if (password) {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(password, saltRounds);
    }
    
    const result = await db.shoofiAdminUsers.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Return updated user without password
    const updatedUser = await db.shoofiAdminUsers.findOne({
      _id: new ObjectId(id)
    }, { projection: { password: 0 } });
    
    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating admin user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Delete admin user
router.delete("/api/admin/users/:id", auth.required, checkAdminRole(["admin"]), async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    const result = await db.shoofiAdminUsers.deleteOne({
      _id: new ObjectId(id)
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting admin user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get available roles
router.get("/api/admin/users/roles", auth.required, checkAdminRole(["admin", "manager"]), (req, res) => {
  const availableRoles = [
    "admin",
    "manager", 
    "operator",
    "viewer",
    "editor"
  ];
  
  res.json({ roles: availableRoles });
});

// Login admin user
router.post("/api/admin/users/login", async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { phoneNumber, password } = req.body;
    
    if (!phoneNumber || !password) {
      return res.status(400).json({ 
        message: "Phone number and password are required" 
      });
    }
    
    // Verify credentials using the auth service
    const user = await adminAuthService.verifyAdminCredentials(
      mongoSanitize(phoneNumber), 
      password, 
      db
    );
    
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    
    // Generate access token
    const accessToken = adminAuthService.generateAccessToken(user);
    
    // Return user data without password and token
    const userData = {
      _id: user._id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      roles: user.roles,
      isFirstLogin: user.isFirstLogin || false
    };
    
    res.json({
      user: userData,
      token: accessToken,
      message: "Login successful"
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Change password (for first time login or regular password change)
router.post("/api/admin/users/change-password", auth.required, async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { userId: bodyUserId, currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: "Current password and new password are required" 
      });
    }
    
    // Get user ID from body or authenticated token
    const userId = bodyUserId || req.adminUser._id;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    // Find user
    const user = await db.shoofiAdminUsers.findOne({
      _id: new ObjectId(userId)
    });
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Verify current password
    const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidCurrentPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password and set isFirstLogin to false
    await db.shoofiAdminUsers.updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          password: hashedNewPassword,
          isFirstLogin: false,
          updatedAt: new Date()
        } 
      }
    );
    
    res.json({ 
      message: "Password changed successfully",
      isFirstLogin: false
    });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Logout admin user
router.post("/api/admin/users/logout", auth.required, async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { userId } = req.body;
    
    // Get user ID from authenticated token (primary source)
    let targetUserId = req.auth.id;
    
    // If specific userId provided in body, use that instead (for admin operations)
    if (userId && req.auth.roles && req.auth.roles.includes('admin')) {
      targetUserId = userId;
    }
    
    if (!targetUserId) {
      return res.status(400).json({ message: "User ID required" });
    }
    
    // Invalidate refresh token
    try {
      await adminAuthService.invalidateRefreshToken(targetUserId, db);
    } catch (invalidateError) {
      console.error("Error invalidating refresh token:", invalidateError);
      // Don't fail logout if token invalidation fails
    }
    
    res.json({ message: "Logout successful" });
  } catch (error) {
    console.error("Error during logout:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Forgot password - send reset code
router.post("/api/admin/users/forgot-password", async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    
    // Find user by phone number
    const user = await db.shoofiAdminUsers.findOne({
      phoneNumber: mongoSanitize(phoneNumber)
    });
    
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({ 
        message: "If a user with this phone number exists, a reset code has been sent",
        success: true
      });
    }
    
    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    
    // Store reset code in database
    await db.shoofiAdminUsers.updateOne(
      { _id: user._id },
      { 
        $set: { 
          resetCode: resetCode,
          resetCodeExpiry: resetCodeExpiry,
          updatedAt: new Date()
        } 
      }
    );
    
    // Send SMS with reset code
    try {
      const smsContent = smsService.getAdminUserResetCodeContent(user.fullName, resetCode);
      await smsService.sendSMS(phoneNumber, smsContent, req, db);
      console.log(`Password reset code sent successfully to ${phoneNumber}`);
    } catch (smsError) {
      console.error("Error sending password reset SMS:", smsError);
      return res.status(500).json({ message: "Error sending reset code. Please try again." });
    }
    
    res.json({ 
      message: "If a user with this phone number exists, a reset code has been sent",
      success: true
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Verify reset code
router.post("/api/admin/users/verify-reset-code", async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { phoneNumber, resetCode } = req.body;
    
    if (!phoneNumber || !resetCode) {
      return res.status(400).json({ message: "Phone number and reset code are required" });
    }
    
    // Find user by phone number and verify reset code
    const user = await db.shoofiAdminUsers.findOne({
      phoneNumber: mongoSanitize(phoneNumber),
      resetCode: resetCode,
      resetCodeExpiry: { $gt: new Date() }
    });
    
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset code" });
    }
    
    // Generate temporary token for password reset (valid for 10 minutes)
    const tempToken = adminAuthService.generateTempResetToken(user);
    
    res.json({ 
      message: "Reset code verified successfully",
      tempToken: tempToken,
      success: true
    });
  } catch (error) {
    console.error("Error verifying reset code:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Reset password with temporary token
router.post("/api/admin/users/reset-password", async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { tempToken, newPassword } = req.body;
    
    if (!tempToken || !newPassword) {
      return res.status(400).json({ message: "Temporary token and new password are required" });
    }
    
    // Verify temporary token
    const decodedToken = adminAuthService.verifyTempResetToken(tempToken);
    if (!decodedToken) {
      return res.status(400).json({ message: "Invalid or expired temporary token" });
    }
    
    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password and clear reset code
    await db.shoofiAdminUsers.updateOne(
      { _id: new ObjectId(decodedToken.userId) },
      { 
        $set: { 
          password: hashedNewPassword,
          isFirstLogin: false,
          updatedAt: new Date()
        },
        $unset: {
          resetCode: "",
          resetCodeExpiry: ""
        }
      }
    );
    
    res.json({ 
      message: "Password reset successfully",
      success: true
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh access token
router.post("/api/admin/users/refresh-token", auth.required, async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }
    
    // Verify the user is requesting to refresh their own token
    const decodedToken = adminAuthService.verifyAccessToken(token);
    if (!decodedToken || decodedToken.id !== req.auth.id) {
      return res.status(403).json({ message: "Can only refresh your own token" });
    }
    
    // Refresh the access token
    const newToken = await adminAuthService.refreshAccessToken(token, db);
    
    if (!newToken) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    
    res.json({
      token: newToken,
      message: "Token refreshed successfully"
    });
  } catch (error) {
    console.error("Error refreshing token:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router; 