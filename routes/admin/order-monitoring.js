const express = require('express');
const router = express.Router();
const centralizedFlowMonitor = require('../../services/monitoring/centralized-flow-monitor');
const auth = require('../../lib/auth');

// Get order timeline with all events
    router.get("/api/admin/order-monitoring/timeline/:orderNumber",  async (req, res) => {
  try {
    const { orderNumber } = req.params;
    
    const timeline = await centralizedFlowMonitor.getCompleteOrderTimeline(orderNumber);
    
    res.status(200).json(timeline);
  } catch (error) {
    console.error('Failed to get order timeline:', error);
    res.status(500).json({ message: "Failed to get order timeline", error: error.message });
  }
});

// Get order status summary
router.get("/api/admin/order-monitoring/summary/:orderNumber",  async (req, res) => {
  try {
    const { orderNumber } = req.params;
    
    const summary = await centralizedFlowMonitor.getOrderStatusSummary(orderNumber);
    
    res.status(200).json(summary);
  } catch (error) {
    console.error('Failed to get order summary:', error);
    res.status(500).json({ message: "Failed to get order summary", error: error.message });
  }
});

// Search orders by status or date range
router.post("/api/admin/order-monitoring/search",  async (req, res) => {
  try {
    const { status, startDate, endDate, sourceApp, limit = 50 } = req.body;
    
    const results = await centralizedFlowMonitor.searchOrders({
      status,
      startDate,
      endDate,
      sourceApp,
      limit
    });
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Failed to search orders:', error);
    res.status(500).json({ message: "Failed to search orders", error: error.message });
  }
});

// Get recent orders with flow events
router.get("/api/admin/order-monitoring/recent",  async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const hours = parseInt(req.query.hours) || 24;
    
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);
    
    const results = await centralizedFlowMonitor.searchOrders({
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      limit
    });
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Failed to get recent orders:', error);
    res.status(500).json({ message: "Failed to get recent orders", error: error.message });
  }
});

// Get order flow statistics
  router.get("/api/admin/order-monitoring/stats",  async (req, res) => {
  try {
    const db = global.app.db['shoofi'];
    const hours = parseInt(req.query.hours) || 24;
    
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);
    
    // Get total events in time range
    const totalEvents = await db.orderFlowEvents.countDocuments({
      timestamp: { $gte: startDate }
    });
    
    // Get events by source app
    const eventsByApp = await db.orderFlowEvents.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$sourceApp',
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    // Get events by type
    const eventsByType = await db.orderFlowEvents.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]).toArray();
    
    // Get unique orders
    const uniqueOrders = await db.orderFlowEvents.distinct('orderNumber', {
      timestamp: { $gte: startDate }
    });
    
    res.status(200).json({
      timeRange: `${hours} hours`,
      totalEvents,
      uniqueOrders: uniqueOrders.length,
      eventsByApp,
      eventsByType: eventsByType.slice(0, 10) // Top 10 event types
    });
  } catch (error) {
    console.error('Failed to get monitoring stats:', error);
    res.status(500).json({ message: "Failed to get monitoring stats", error: error.message });
  }
});

module.exports = router; 