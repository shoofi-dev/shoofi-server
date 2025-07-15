# Distributed Cron Jobs with Redis Locking

## Overview

This system ensures that cron jobs run only once across multiple server instances using Redis distributed locking. This prevents duplicate job execution, duplicate notifications, and unnecessary database load when scaling your application.

## How It Works

### Distributed Locking Mechanism

1. **Lock Acquisition**: Before running a cron job, each server tries to acquire a Redis lock
2. **Single Execution**: Only the server that successfully acquires the lock runs the job
3. **Automatic Expiry**: Locks have a TTL (Time To Live) to prevent deadlocks
4. **Graceful Release**: Locks are released when jobs complete or fail

### Redis Lock Implementation

```javascript
// Try to acquire lock
const result = await redis.set(key, 'locked', 'PX', ttlMs, 'NX');
return result === 'OK';
```

- **`PX`**: Sets expiry time in milliseconds
- **`NX`**: Only set if key doesn't exist (atomic operation)
- **Returns `'OK'`**: If lock was acquired successfully

## Current Cron Jobs

### 1. Store Auto-Close
- **Lock Key**: `cron:store-auto-close`
- **TTL**: 10 minutes
- **Schedule**: Daily at 12:00 AM and 6:00 AM
- **Purpose**: Automatically close stores when work hours end

### 2. Store Open Reminder
- **Lock Key**: `cron:store-open-reminder`
- **TTL**: 5 minutes
- **Schedule**: Every 30 minutes
- **Purpose**: Remind stores to open when they should be open

## Files Structure

```
utils/
├── redis-lock.js              # Distributed locking utility
└── crons/
    ├── store-auto-close.js    # Auto-close cron with locking
    └── store-open-reminder.js # Open reminder cron with locking
```

## Redis Lock Utility

### Functions

#### `acquireLock(key, ttlMs)`
- Tries to acquire a distributed lock
- Returns `true` if successful, `false` if another server has the lock
- Automatically sets expiry to prevent deadlocks

#### `releaseLock(key)`
- Releases a distributed lock
- Safe to call even if lock doesn't exist
- Used in `finally` blocks to ensure cleanup

#### `isLocked(key)`
- Checks if a lock currently exists
- Useful for monitoring and debugging

### Usage Example

```javascript
const { acquireLock, releaseLock } = require('../redis-lock');

async function myCronJob() {
  const lockKey = 'cron:my-job';
  const lockTtl = 5 * 60 * 1000; // 5 minutes

  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running this job, skipping.');
    return;
  }

  try {
    // Your cron job logic here
    console.log('Running cron job...');
  } finally {
    await releaseLock(lockKey);
  }
}
```

## Configuration

### Environment Variables

The Redis lock utility uses the same configuration as your existing Redis setup:

- `REDIS_URL` - Full Redis connection string
- `REDIS_HOST` - Redis host (fallback)
- `REDIS_PORT` - Redis port (fallback)
- `REDIS_PASSWORD` - Redis password (fallback)

### Lock TTL Guidelines

- **Short jobs** (< 1 minute): 2-3 minutes TTL
- **Medium jobs** (1-5 minutes): 5-10 minutes TTL
- **Long jobs** (> 5 minutes): 2x expected duration

## Benefits

### ✅ **No Duplicate Execution**
- Only one server runs each job at a time
- Prevents database conflicts and race conditions

### ✅ **No Duplicate Notifications**
- WebSocket notifications sent only once
- Email/SMS notifications sent only once

### ✅ **Automatic Recovery**
- Locks expire automatically if server crashes
- No manual intervention needed

### ✅ **Scalable**
- Works with any number of server instances
- Minimal Redis overhead

### ✅ **Fault Tolerant**
- Graceful handling of Redis connection issues
- Jobs continue to work even if Redis is temporarily unavailable

## Monitoring

### Log Messages

The system provides clear logging for monitoring:

```
✅ Redis connected for distributed locks
✅ Redis ready for distributed locks
Another server is running the store auto-close cron, skipping.
Starting store auto-close cron job...
Store auto-close cron job completed successfully
```

### Redis Keys

Monitor these Redis keys for debugging:

- `cron:store-auto-close` - Auto-close job lock
- `cron:store-open-reminder` - Open reminder job lock

### Health Checks

You can check if locks are active:

```javascript
const { isLocked } = require('../redis-lock');

// Check if auto-close job is running
const isAutoCloseRunning = await isLocked('cron:store-auto-close');
console.log('Auto-close job running:', isAutoCloseRunning);
```

## Troubleshooting

### Common Issues

#### 1. **Lock Never Expires**
- **Cause**: Job crashed before releasing lock
- **Solution**: Locks have TTL, will expire automatically
- **Prevention**: Use `try/finally` blocks

#### 2. **Redis Connection Issues**
- **Cause**: Redis server down or network issues
- **Solution**: Jobs will run on all servers (fallback behavior)
- **Prevention**: Monitor Redis health

#### 3. **Jobs Not Running**
- **Cause**: Lock acquired by another server
- **Solution**: Check logs for "skipping" messages
- **Verification**: Use `isLocked()` to check lock status

### Debug Commands

```bash
# Check Redis keys
redis-cli keys "cron:*"

# Check lock TTL
redis-cli ttl "cron:store-auto-close"

# Delete lock manually (emergency only)
redis-cli del "cron:store-auto-close"
```

## Best Practices

### 1. **Always Use try/finally**
```javascript
try {
  // Job logic
} finally {
  await releaseLock(lockKey);
}
```

### 2. **Set Appropriate TTL**
- Too short: Jobs might be interrupted
- Too long: Slower recovery from crashes

### 3. **Use Descriptive Lock Keys**
- Include job name: `cron:store-auto-close`
- Include environment: `cron:store-auto-close:production`

### 4. **Monitor Lock Duration**
- Log job start and end times
- Alert if jobs take longer than expected

### 5. **Test with Multiple Servers**
- Verify only one server runs jobs
- Test Redis failover scenarios

## Future Enhancements

- **Lock Renewal**: Automatically extend locks for long-running jobs
- **Lock Statistics**: Track lock acquisition success rates
- **Health Dashboard**: Web interface to monitor job status
- **Alerting**: Notify when jobs fail to acquire locks repeatedly 