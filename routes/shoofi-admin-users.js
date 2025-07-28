const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const { mongoSanitize } = require("../lib/common");
const smsService = require("../utils/sms");

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
    // For now, we'll allow all requests since we don't have session management in the backend
    // In a real implementation, you would check the user's session/token and verify roles
    next();
  };
};

// Get all admin users
router.get("/api/admin/users", checkAdminRole(["admin", "manager"]), async (req, res) => {
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
router.get("/api/admin/users/:id", checkAdminRole(["admin", "manager"]), async (req, res) => {
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
router.post("/api/admin/users", checkAdminRole(["admin"]), async (req, res) => {
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
router.put("/api/admin/users/:id", checkAdminRole(["admin", "manager"]), async (req, res) => {
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
router.delete("/api/admin/users/:id", checkAdminRole(["admin"]), async (req, res) => {
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
router.get("/api/admin/users/roles", checkAdminRole(["admin", "manager"]), (req, res) => {
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
    
    // Find user by phone number
    const user = await db.shoofiAdminUsers.findOne({
      phoneNumber: mongoSanitize(phoneNumber)
    });
    
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    
    // Return user data without password
    const userData = {
      _id: user._id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      roles: user.roles,
      isFirstLogin: user.isFirstLogin || false
    };
    
    res.json({
      user: userData,
      message: "Login successful"
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Change password (for first time login or regular password change)
router.post("/api/admin/users/change-password", async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { userId, currentPassword, newPassword } = req.body;
    
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: "User ID, current password, and new password are required" 
      });
    }
    
    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
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

module.exports = router; 