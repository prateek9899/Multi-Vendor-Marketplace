const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Vendor = require('../models/Vendor');

exports.getAdminAnalytics = async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [orderSummary, newOrders, userCount, vendorStatus, topProducts, dailyRevenue] = await Promise.all([
      Order.aggregate([
        { $match: {
          createdAt: { $gte: since },
          $or: [
            { 'paymentInfo.status': 'paid' },
            { 'paymentInfo.method': 'cod', orderStatus: 'delivered' },
          ],
        } },
        { $group: {
          _id: null,
          orders: { $sum: 1 },
          grossSales: { $sum: '$totalAmount' },
          platformCommission: { $sum: { $ifNull: ['$paymentInfo.commissionTotal', 0] } },
        } },
      ]),
      Order.countDocuments({ createdAt: { $gte: since } }),
      User.countDocuments({ createdAt: { $gte: since } }),
      Vendor.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Product.find({ isActive: true }).sort({ totalSold: -1 }).limit(5).select('name totalSold price images'),
      Order.aggregate([
        { $match: {
          createdAt: { $gte: since },
          $or: [
            { 'paymentInfo.status': 'paid' },
            { 'paymentInfo.method': 'cod', orderStatus: 'delivered' },
          ],
        } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
        } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const [customers, vendors, products] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      Vendor.countDocuments(),
      Product.countDocuments({ isActive: true }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        periodDays: 30,
        summary: {
          ...(orderSummary[0] || { orders: 0, grossSales: 0, platformCommission: 0 }),
          newOrders,
          newUsers: userCount,
          customers,
          vendors,
          activeProducts: products,
        },
        vendorStatus,
        topProducts,
        dailyRevenue,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
