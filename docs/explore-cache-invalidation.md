# Explore Cache Invalidation Strategy

## Overview

The explore screen uses server-side caching to improve performance, but when store status changes (open/closed), the cache needs to be invalidated to ensure clients see real-time updates.

## Cache Structure

### Cache Keys
- `explore_categories_default` - Default cache when no location provided
- `explore_categories_area_{areaId}` - Area-based cache for delivery areas
- `explore_categories_no_area_{lat}_{lng}` - Location-based cache for areas without delivery zones

### Cache TTL
- **5 minutes** - Shorter TTL due to frequent store status changes
- Cache automatically expires and refreshes

## Cache Invalidation Triggers

### 1. Store Status Changes
When a store updates its `isOpen` or `isStoreClose` status:

```javascript
// In store update endpoints
const isStatusChanging = currentStore && (
  currentStore.isOpen !== storeDoc.isOpen || 
  currentStore.isStoreClose !== storeDoc.isStoreClose
);

if (isStatusChanging) {
  await clearExploreCacheForStore(currentStore);
}
```

### 2. Auto-Close Cron Job
When stores are automatically closed based on business hours:

```javascript
// In store-auto-close.js
await clearExploreCacheForStore(storeData);
```

### 3. Manual Cache Management
Admin endpoints for cache management:

```bash
# Clear all cache
POST /api/shoofiAdmin/explore/clear-cache

# Get cache statistics
GET /api/shoofiAdmin/explore/cache-stats

# Debug area lookup
POST /api/shoofiAdmin/explore/debug-area
```

## Cache Invalidation Strategy

### Granular Invalidation
- **Store-specific**: Clears location-based cache for the store's location
- **Area-based**: Clears all area caches (since we don't know which area contains the store)
- **Fallback**: Clears all cache if store location is unknown

### WebSocket Integration
When cache is invalidated, WebSocket notifications are sent:

```javascript
// Send to customers
websocketService.sendToAppCustomers('shoofi-shopping', {
  type: 'store_refresh',
  data: { 
    action: 'store_updated', 
    appName: appName 
  }
});
```

## Client-Side Handling

### Explore Screen
The explore screen listens for WebSocket events and refetches data:

```typescript
useEffect(() => {
  if (websocket?.lastMessage) {
    if (websocket?.lastMessage?.type === "store_refresh") {
      console.log('Store refresh received, refetching explore data');
      setHideSplash(true);
      refetch();
    }
  }
}, [websocket?.lastMessage, refetch]);
```

### Optimized Fetch Hook
Uses `useParallelFetch` with dependencies to refetch when location changes:

```typescript
const {
  data: fetchData,
  loading,
  error,
  refetch,
} = useParallelFetch<ExploreData>(
  {
    categoriesWithStores: debouncedLocation
      ? `/shoofiAdmin/explore/categories-with-stores?location=${JSON.stringify(debouncedLocation)}`
      : "/shoofiAdmin/explore/categories-with-stores",
  },
  {
    ttl: 5 * 60 * 1000, // 5 minutes cache
    dependencies: [debouncedLocation], // Refetch when location changes
  }
);
```

## Performance Considerations

### Cache Hit Rate
- Monitor cache hit rates using `/api/shoofiAdmin/explore/cache-stats`
- Cache should have high hit rates for similar locations

### Memory Management
- Maximum 100 cache entries
- Automatic cleanup of oldest entries
- 5-minute TTL prevents stale data

### Network Optimization
- Clients only refetch when cache is invalidated
- Location-based caching reduces unnecessary API calls
- WebSocket events trigger immediate updates

## Monitoring and Debugging

### Cache Statistics
```bash
GET /api/shoofiAdmin/explore/cache-stats
```

Response:
```json
{
  "size": 15,
  "entries": [
    {
      "key": "explore_categories_area_507f1f77bcf86cd799439011",
      "cacheType": "area-based",
      "age": 120000,
      "ttl": 300000,
      "dataSize": 8
    }
  ]
}
```

### Debug Area Lookup
```bash
POST /api/shoofiAdmin/explore/debug-area
{
  "location": {
    "lat": 32.0853,
    "lng": 34.7818
  }
}
```

### Logs
Cache operations are logged with details:
- Cache hits/misses
- Invalidation events
- Store status changes
- Area lookups

## Best Practices

1. **Always check status changes** before clearing cache
2. **Use granular invalidation** when possible
3. **Monitor cache performance** regularly
4. **Test cache invalidation** in development
5. **Document cache keys** for debugging

## Troubleshooting

### Cache Not Clearing
- Check if store status actually changed
- Verify cache key generation
- Check server logs for cache operations

### Stale Data
- Verify TTL settings
- Check if WebSocket events are received
- Ensure client refetch is working

### Performance Issues
- Monitor cache size
- Check memory usage
- Review cache hit rates 