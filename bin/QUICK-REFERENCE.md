# 🚀 Quick Reference: Barcode ID Migration Scripts

## ✅ **Fixed Issues**
- Scripts now properly handle environment file parameters
- Command-line flags are parsed correctly
- Store names are no longer confused with options

## 🎯 **Correct Usage Examples**

### **Basic Usage**
```bash
# Process all stores (default settings)
node bin/add-barcode-ids-to-products.js

# Process specific store
node bin/add-barcode-ids-to-products.js shoofi
```

### **With Environment Files**
```bash
# Use development environment
node bin/add-barcode-ids-to-products.js --env=bin/env.development

# Use production environment
node bin/add-barcode-ids-to-products.js --env=bin/env.production

# Use environment file + specific store
node bin/add-barcode-ids-to-products.js --env=bin/env.production shoofi
```

### **Alternative Syntax**
```bash
# These are equivalent:
node bin/add-barcode-ids-to-products.js --env=bin/env.development
node bin/add-barcode-ids-to-products.js --env-file=bin/env.development
```

## 📁 **Environment Files Available**

### **`bin/env.development`**
```bash
MONGODB_URI=mongodb://localhost:27017
DB_NAME=shoofi_dev
NODE_ENV=development
LOG_LEVEL=debug
BATCH_SIZE=50
DELAY_MS=100
```

### **`bin/env.production`**
```bash
MONGODB_URI=mongodb://prod-user:prod-pass@prod-server:27017
DB_NAME=shoofi_production
NODE_ENV=production
LOG_LEVEL=info
BATCH_SIZE=500
DELAY_MS=25
```

## 🔧 **What Was Fixed**

### **Before (Broken)**
```bash
# This was interpreted as a store name, causing errors
node bin/add-barcode-ids-to-products.js --env=.env.development
# Error: db.db is not a function (treating --env=.env.development as store name)
```

### **After (Fixed)**
```bash
# This now works correctly
node bin/add-barcode-ids-to-products.js --env=bin/env.development
# ✅ Loaded environment from: bin/env.development
# ✅ Configuration loaded correctly
```

## 🎛️ **Command-Line Options**

| Option | Description | Example |
|--------|-------------|---------|
| `--env=<file>` | Load environment from file | `--env=bin/env.production` |
| `--env-file=<file>` | Same as --env | `--env-file=bin/env.production` |
| `--help` | Show help message | `--help` |
| `[storeName]` | Process specific store | `shoofi` |

## 🚨 **Common Mistakes to Avoid**

### **❌ Wrong (Don't do this)**
```bash
# Missing equals sign
node bin/add-barcode-ids-to-products.js --env bin/env.development

# Wrong file path
node bin/add-barcode-ids-to-products.js --env=.env.development

# Wrong order
node bin/add-barcode-ids-to-products.js shoofi --env=bin/env.development
```

### **✅ Correct (Do this)**
```bash
# With equals sign
node bin/add-barcode-ids-to-products.js --env=bin/env.development

# Correct file path
node bin/add-barcode-ids-to-products.js --env=bin/env.development

# Correct order (options first, then store name)
node bin/add-barcode-ids-to-products.js --env=bin/env.development shoofi
```

## 🧪 **Test Your Setup**

1. **Check help**:
   ```bash
   node bin/add-barcode-ids-to-products.js --help
   ```

2. **Test with development env**:
   ```bash
   node bin/add-barcode-ids-to-products.js --env=bin/env.development
   ```

3. **Test with specific store**:
   ```bash
   node bin/add-barcode-ids-to-products.js --env=bin/env.development shoofi
   ```

## 🎉 **Success Indicators**

When the script runs correctly, you should see:
```
📁 Loaded environment from: bin/env.development
🚀 Starting barcodeId migration script...
Configuration:
  MongoDB URI: mongodb://localhost:27017
  Database: shoofi_dev
  Environment: development
  Batch Size: 50
  Delay: 100ms
🔌 Connecting to MongoDB...
✅ Connected to MongoDB
```

## 🔍 **Troubleshooting**

If you still get errors:
1. **Check file paths**: Use `bin/env.development` not `.env.development`
2. **Check syntax**: Use `--env=filename` not `--env filename`
3. **Check order**: Options first, then store name
4. **Use help**: `node bin/add-barcode-ids-to-products.js --help`
