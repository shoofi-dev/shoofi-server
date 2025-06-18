const { MongoClient } = require('mongodb');

class PerformanceMonitor {
  constructor() {
    this.slowQueryThreshold = 100; // milliseconds
    this.queries = [];
  }

  startTimer() {
    return Date.now();
  }

  endTimer(startTime, query, collection) {
    const duration = Date.now() - startTime;
    
    if (duration > this.slowQueryThreshold) {
      this.queries.push({
        query,
        collection,
        duration,
        timestamp: new Date(),
        slow: true
      });
      
      console.warn(`⚠️  Slow query detected: ${duration}ms on ${collection}`, {
        query: JSON.stringify(query, null, 2)
      });
    }
    
    return duration;
  }

  getSlowQueries() {
    return this.queries.filter(q => q.slow);
  }

  getStats() {
    const totalQueries = this.queries.length;
    const slowQueries = this.queries.filter(q => q.slow).length;
    const avgDuration = totalQueries > 0 
      ? this.queries.reduce((sum, q) => sum + q.duration, 0) / totalQueries 
      : 0;
    
    return {
      totalQueries,
      slowQueries,
      avgDuration: Math.round(avgDuration),
      slowQueryPercentage: totalQueries > 0 ? (slowQueries / totalQueries * 100).toFixed(2) : 0
    };
  }

  clear() {
    this.queries = [];
  }
}

// Global instance
const performanceMonitor = new PerformanceMonitor();

// Middleware to monitor database queries
function monitorQuery(req, res, next) {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Add performance headers
    res.set('X-Query-Count', performanceMonitor.getStats().totalQueries);
    res.set('X-Avg-Query-Time', performanceMonitor.getStats().avgDuration);
    
    originalSend.call(this, data);
  };
  
  next();
}

// Database query wrapper
async function monitoredQuery(collection, operation, query, options = {}) {
  const startTime = performanceMonitor.startTimer();
  
  try {
    const result = await collection[operation](query, options);
    performanceMonitor.endTimer(startTime, query, collection.collectionName);
    return result;
  } catch (error) {
    performanceMonitor.endTimer(startTime, query, collection.collectionName);
    throw error;
  }
}

module.exports = {
  PerformanceMonitor,
  performanceMonitor,
  monitorQuery,
  monitoredQuery
}; 