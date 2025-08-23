# Universal Links Setup Guide

This guide explains how to set up Universal Links (iOS) and App Links (Android) for the Shoofi store sharing functionality.

## 🍎 **iOS Universal Links Setup**

### 1. **App Configuration (app.json)**
```json
{
  "expo": {
    "scheme": "shoofi",
    "ios": {
      "bundleIdentifier": "com.shoofi.shopping",
      "associatedDomains": ["applinks:shoofi-api-95miq.ondigitalocean.app"]
    }
  }
}
```

### 2. **Server Configuration File**
Create file: `public/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.shoofi.shopping",
        "paths": [
          "/api/store/open/*"
        ]
      },
      {
        "appID": "TEAM_ID.com.shoofi.partners",
        "paths": [
          "/api/store/open/*"
        ]
      },
      {
        "appID": "TEAM_ID.com.shoofi.shoofir",
        "paths": [
          "/api/store/open/*"
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": [
      "TEAM_ID.com.shoofi.shopping",
      "TEAM_ID.com.shoofi.partners",
      "TEAM_ID.com.shoofi.shoofir"
    ]
  }
}
```

### 3. **Required Actions**
- Replace `TEAM_ID` with your actual Apple Developer Team ID
- Ensure the file is served with `Content-Type: application/json`
- File must be accessible at: `https://your-domain.com/.well-known/apple-app-site-association`

## 🤖 **Android App Links Setup**

### 1. **App Configuration (app.json)**
```json
{
  "expo": {
    "scheme": "shoofi",
    "android": {
      "package": "com.shoofi.shopping",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "shoofi-api-95miq.ondigitalocean.app",
              "pathPrefix": "/api/store/open"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### 2. **Server Configuration File**
Create file: `public/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.shoofi.shopping",
      "sha256_cert_fingerprints": [
        "SHA256_FINGERPRINT_FOR_SHOOFI_SHOPPING"
      ]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.shoofi.partners",
      "sha256_cert_fingerprints": [
        "SHA256_FINGERPRINT_FOR_SHOOFI_PARTNERS"
      ]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.shoofi.shoofir",
      "sha256_cert_fingerprints": [
        "SHA256_FINGERPRINT_FOR_SHOOFI_SHOOFIR"
      ]
    }
  }
]
```

### 3. **Required Actions**
- Replace `SHA256_FINGERPRINT_FOR_*` with actual SHA256 fingerprints
- Get fingerprints from your keystore or Google Play Console
- File must be accessible at: `https://your-domain.com/.well-known/assetlinks.json`

## 🔧 **Server Setup**

### 1. **File Structure**
```
shoofi-server/
├── public/
│   └── .well-known/
│       ├── apple-app-site-association
│       └── assetlinks.json
└── routes/
    └── shoofi-admin.js
```

### 2. **Server Routes**
The server automatically serves these files via the routes:
```javascript
// Route to serve Universal Links configuration files
router.get("/.well-known/apple-app-site-association", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, '../public/.well-known/apple-app-site-association'));
});

router.get("/.well-known/assetlinks.json", (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, '../public/.well-known/assetlinks.json'));
});
```

## 🧪 **Testing Universal Links**

### 1. **iOS Testing**
```bash
# Test in iOS Simulator
xcrun simctl openurl booted "https://shoofi-api-95miq.ondigitalocean.app/api/store/open/pizza-gmel"

# Test custom scheme
xcrun simctl openurl booted "shoofi://store/pizza-gmel"
```

### 2. **Android Testing**
```bash
# Test in Android Emulator
adb shell am start -W -a android.intent.action.VIEW -d "https://shoofi-api-95miq.ondigitalocean.app/api/store/open/pizza-gmel"

# Test custom scheme
adb shell am start -W -a android.intent.action.VIEW -d "shoofi://store/pizza-gmel"
```

### 3. **Web Testing**
Open in browser: `https://shoofi-api-95miq.ondigitalocean.app/api/store/open/pizza-gmel`

## 🔍 **Verification Steps**

### 1. **Check File Accessibility**
```bash
# Test iOS config
curl -I https://shoofi-api-95miq.ondigitalocean.app/.well-known/apple-app-site-association

# Test Android config
curl -I https://shoofi-api-95miq.ondigitalocean.app/.well-known/assetlinks.json
```

### 2. **Validate JSON Format**
```bash
# Validate iOS config
curl https://shoofi-api-95miq.ondigitalocean.app/.well-known/apple-app-site-association | jq .

# Validate Android config
curl https://shoofi-api-95miq.ondigitalocean.app/.well-known/assetlinks.json | jq .
```

### 3. **Test Deep Link Handling**
- Install the app on a device
- Click a store sharing link
- Verify the app opens directly to the store

## 🚨 **Common Issues & Solutions**

### 1. **iOS Universal Links Not Working**
- **Issue**: Links not opening in app
- **Solution**: 
  - Verify Team ID is correct
  - Ensure file is served with correct Content-Type
  - Check that associatedDomains is set in app.json
  - Wait 24-48 hours for Apple's CDN to update

### 2. **Android App Links Not Working**
- **Issue**: Links opening in browser instead of app
- **Solution**:
  - Verify SHA256 fingerprints are correct
  - Ensure autoVerify is set to true
  - Check that intentFilters are properly configured
  - Test on device (not emulator) for autoVerify

### 3. **Configuration Files Not Accessible**
- **Issue**: 404 errors when accessing .well-known files
- **Solution**:
  - Verify file paths are correct
  - Check server routes are properly configured
  - Ensure files are in the public directory
  - Test with curl or browser

## 📱 **App Integration**

### 1. **Deep Link Handling**
The app automatically handles both types of links:
- **Custom Scheme**: `shoofi://store/pizza-gmel`
- **Universal Links**: `https://your-domain.com/api/store/open/pizza-gmel`

### 2. **Navigation**
When a deep link is received:
1. App detects the store app name
2. Validates store exists
3. Sets the store database name
4. Navigates to the appropriate screen
5. Loads store data

### 3. **Fallback Handling**
If the app is not installed:
1. User sees a web page with store information
2. Download options are provided
3. After installation, the same link works in the app

## 🎯 **Benefits of Universal Links**

1. **Seamless Experience**: Same URL works before and after app installation
2. **Better SEO**: Links work in search results and social media
3. **Improved Conversion**: Direct path to store reduces friction
4. **Cross-Platform**: Works on iOS, Android, and web
5. **Professional**: Looks like regular web links

## 🔄 **Next Steps**

1. **Update Configuration Files**: Replace placeholder values with actual Team IDs and fingerprints
2. **Test Deep Links**: Verify both custom scheme and Universal Links work
3. **Deploy to Production**: Ensure configuration files are accessible
4. **Monitor Analytics**: Track deep link usage and conversion rates
5. **User Testing**: Test with real users to ensure smooth experience

## 📞 **Support**

For issues with Universal Links setup:
1. Check this guide for common solutions
2. Verify all configuration files are correct
3. Test with the provided commands
4. Check server logs for errors
5. Contact the development team if issues persist
