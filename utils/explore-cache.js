// Explore cache management utility
const exploreCache = new Map();

async function getExploreCache(key) {
  const entry = exploreCache.get(key);
  if (!entry) {
    console.log(`Cache miss for key: ${key}`);
    return null;
  }
  
  // Check if cache is expired
  if (Date.now() - entry.timestamp > entry.ttl) {
    console.log(`Cache expired for key: ${key}`);
    exploreCache.delete(key);
    return null;
  }
  
  console.log(`Cache hit for key: ${key}, age: ${Date.now() - entry.timestamp}ms`);
  return entry.data;
}

async function setExploreCache(key, data, ttl = 5 * 60 * 1000) {
  exploreCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
  
  console.log(`Cache set for key: ${key}, size: ${data.length}, ttl: ${ttl}ms`);
  
  // Clean up old entries (keep only last 100 entries)
  if (exploreCache.size > 100) {
    const entries = Array.from(exploreCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - 100);
    toDelete.forEach(([key]) => exploreCache.delete(key));
    console.log(`Cache cleanup: removed ${toDelete.length} old entries`);
  }
}

// Clear all explore cache
async function clearExploreCache() {
  const size = exploreCache.size;
  exploreCache.clear();
  console.log(`Explore cache cleared: ${size} entries removed`);
}

// Clear cache for specific area
async function clearExploreCacheForArea(areaId) {
  const cacheKey = `explore_categories_area_${areaId}`;
  const wasDeleted = exploreCache.delete(cacheKey);
  console.log(`Area cache cleared for ${areaId}: ${wasDeleted ? 'deleted' : 'not found'}`);
}

// Clear cache for specific location
async function clearExploreCacheForLocation(location) {
  if (!location) return;
  
  const lat = location.lat || location.coordinates?.[1];
  const lng = location.lng || location.coordinates?.[0];
  
  if (lat && lng) {
    const cacheKey = `explore_categories_no_area_${lat}_${lng}`;
    const wasDeleted = exploreCache.delete(cacheKey);
    console.log(`Location cache cleared for (${lat}, ${lng}): ${wasDeleted ? 'deleted' : 'not found'}`);
  }
}

// Clear cache for specific store (clears all area caches that might contain this store)
async function clearExploreCacheForStore(storeData) {
  if (!storeData) return;
  
  // If store has location, clear location-based cache
  if (storeData.location) {
    await clearExploreCacheForLocation(storeData.location);
  }
  
  // Clear all area-based caches since we don't know which area the store belongs to
  // This is a bit aggressive but ensures consistency
  const areaKeys = Array.from(exploreCache.keys()).filter(key => 
    key.startsWith('explore_categories_area_')
  );
  
  areaKeys.forEach(key => {
    exploreCache.delete(key);
  });
  
  console.log(`Store cache cleared for ${storeData.appName}: ${areaKeys.length} area caches removed`);
}

// Get cache stats
function getCacheStats() {
  return {
    size: exploreCache.size,
    entries: Array.from(exploreCache.entries()).map(([key, entry]) => ({
      key,
      cacheType: key.startsWith('explore_categories_area_') ? 'area-based' : 
                 key.startsWith('explore_categories_no_area_') ? 'location-based' : 'default',
      age: Date.now() - entry.timestamp,
      ttl: entry.ttl,
      dataSize: entry.data ? entry.data.length : 0
    }))
  };
}

module.exports = {
  getExploreCache,
  setExploreCache,
  clearExploreCache,
  clearExploreCacheForArea,
  clearExploreCacheForLocation,
  clearExploreCacheForStore,
  getCacheStats
}; 