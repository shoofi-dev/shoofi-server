const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// JWT configuration
const JWT_SECRET = 'secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'shoofi-admin-refresh-secret-key-change-in-production';
const JWT_TEMP_RESET_SECRET = process.env.JWT_TEMP_RESET_SECRET || 'shoofi-admin-temp-reset-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = '180m'; // 60 minutes
const REFRESH_TOKEN_EXPIRY = '365d'; // 365 days
const TEMP_RESET_TOKEN_EXPIRY = '10m'; // 10 minutes for password reset

/**
 * Generate access token for admin user
 * @param {Object} user - Admin user object
 * @returns {String} JWT access token
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      phoneNumber: user.phoneNumber,
      roles: user.roles,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

/**
 * Generate refresh token for admin user
 * @param {Object} user - Admin user object
 * @returns {String} JWT refresh token
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      phoneNumber: user.phoneNumber,
      type: 'refresh'
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
};

/**
 * Generate both access and refresh tokens
 * @param {Object} user - Admin user object
 * @returns {Object} Object containing access and refresh tokens
 */
const generateTokens = (user) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  
  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60, // 15 minutes in seconds
    refreshExpiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
  };
};

/**
 * Verify access token
 * @param {String} token - JWT access token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Verify refresh token
 * @param {String} token - JWT refresh token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Refresh access token using current token
 * @param {String} currentToken - Current JWT access token
 * @param {Object} db - Database instance
 * @returns {String|null} New token or null if invalid
 */
const refreshAccessToken = async (currentToken, db) => {
  try {
    const decoded = verifyAccessToken(currentToken);
    if (!decoded) {
      return null;
    }

    // Find user by ID
    const user = await db.shoofiAdminUsers.findOne({
      _id: decoded.id
    });

    if (!user) {
      return null;
    }

    // Generate new access token
    const newToken = generateAccessToken(user);
    
    // Update last token refresh timestamp
    await db.shoofiAdminUsers.updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastTokenRefresh: new Date()
        } 
      }
    );

    return newToken;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return null;
  }
};

/**
 * Store refresh token in database
 * @param {String} userId - User ID
 * @param {String} refreshToken - Refresh token
 * @param {Object} db - Database instance
 */
const storeRefreshToken = async (userId, refreshToken, db) => {
  try {
    await db.shoofiAdminUsers.updateOne(
      { _id: userId },
      { 
        $set: { 
          refreshToken: refreshToken,
          lastTokenRefresh: new Date()
        } 
      }
    );
  } catch (error) {
    console.error('Error storing refresh token:', error);
  }
};

/**
 * Invalidate refresh token (logout)
 * @param {String} userId - User ID
 * @param {Object} db - Database instance
 */
const invalidateRefreshToken = async (userId, db) => {
  try {
    await db.shoofiAdminUsers.updateOne(
      { _id: userId },
      { 
        $unset: { 
          refreshToken: "",
          lastTokenRefresh: ""
        } 
      }
    );
  } catch (error) {
    console.error('Error invalidating refresh token:', error);
  }
};

/**
 * Verify admin user credentials
 * @param {String} phoneNumber - Phone number
 * @param {String} password - Password
 * @param {Object} db - Database instance
 * @returns {Object|null} User object or null if invalid
 */
const verifyAdminCredentials = async (phoneNumber, password, db) => {
  try {
    const user = await db.shoofiAdminUsers.findOne({ phoneNumber });
    
    if (!user) {
      return null;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return null;
    }

    return user;
  } catch (error) {
    console.error('Error verifying admin credentials:', error);
    return null;
  }
};

/**
 * Generate temporary reset token for password reset
 * @param {Object} user - Admin user object
 * @returns {String} JWT temporary reset token
 */
const generateTempResetToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      phoneNumber: user.phoneNumber,
      type: 'temp-reset'
    },
    JWT_TEMP_RESET_SECRET,
    { expiresIn: TEMP_RESET_TOKEN_EXPIRY }
  );
};

/**
 * Verify temporary reset token
 * @param {String} token - JWT temporary reset token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
const verifyTempResetToken = (token) => {
  try {
    return jwt.verify(token, JWT_TEMP_RESET_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateTokens,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  storeRefreshToken,
  invalidateRefreshToken,
  verifyAdminCredentials,
  generateTempResetToken,
  verifyTempResetToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_TEMP_RESET_SECRET
};
