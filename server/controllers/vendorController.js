const Vendor = require('../models/Vendor');
const User = require('../models/User');
const slugify = require('slugify');
const { uploadToS3 } = require('../config/s3');

// @desc    Register/onboard as vendor
// @route   POST /api/vendors/register
// @access  Private (customer or vendor role)
exports.registerVendor = async (req, res) => {
  try {
    // Check if already a vendor
    const existingVendor = await Vendor.findOne({ user: req.user._id });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: 'You already have a vendor account.',
        data: { vendor: existingVendor },
      });
    }

    const { storeName, storeDescription, businessInfo, bankDetails } = req.body;

    const slug = slugify(storeName, { lower: true, strict: true });

    // Check for duplicate store name
    const existingStore = await Vendor.findOne({ slug });
    if (existingStore) {
      return res.status(400).json({
        success: false,
        message: 'A store with this name already exists.',
      });
    }

    const vendor = await Vendor.create({
      user: req.user._id,
      storeName,
      slug,
      storeDescription,
      businessInfo,
      bankDetails,
      commissionRate: process.env.PLATFORM_COMMISSION_RATE || 10,
    });

    // Update user role to vendor
    await User.findByIdAndUpdate(req.user._id, { role: 'vendor' });

    res.status(201).json({
      success: true,
      message: 'Vendor registration submitted! Awaiting approval.',
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get vendor profile
// @route   GET /api/vendors/profile
// @access  Private (vendor)
exports.getVendorProfile = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id }).populate('user', 'name email phone avatar');
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found.',
      });
    }

    res.status(200).json({
      success: true,
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update vendor profile
// @route   PUT /api/vendors/profile
// @access  Private (vendor)
exports.updateVendorProfile = async (req, res) => {
  try {
    const { storeDescription, businessInfo, bankDetails } = req.body;
    const updateData = {};

    if (storeDescription !== undefined) updateData.storeDescription = storeDescription;
    if (businessInfo) updateData.businessInfo = businessInfo;
    if (bankDetails) updateData.bankDetails = bankDetails;

    const vendor = await Vendor.findOneAndUpdate(
      { user: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Upload store logo/banner
// @route   POST /api/vendors/upload-logo
// @access  Private (vendor)
exports.uploadStoreLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image.',
      });
    }

    const result = await uploadToS3(req.file, 'vendors/logos');
    const vendor = await Vendor.findOneAndUpdate(
      { user: req.user._id },
      { storeLogo: { url: result.url, key: result.key } },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get vendor store by slug (public)
// @route   GET /api/vendors/store/:slug
// @access  Public
exports.getVendorStore = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      slug: req.params.slug,
      status: 'approved',
    })
      .populate('user', 'name avatar')
      .select('-businessInfo -bankDetails -razorpayAccountId');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Store not found.',
      });
    }

    res.status(200).json({
      success: true,
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all vendors (admin)
// @route   GET /api/vendors
// @access  Private (admin)
exports.getAllVendors = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const query = {};

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { storeName: { $regex: search, $options: 'i' } },
        { 'businessInfo.businessName': { $regex: search, $options: 'i' } },
      ];
    }

    const vendors = await Vendor.find(query)
      .populate('user', 'name email phone')
      .select('-bankDetails')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Vendor.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        vendors,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update vendor status (admin)
// @route   PUT /api/vendors/:id/status
// @access  Private (admin)
exports.updateVendorStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor status.' });
    }
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('user', 'name email');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found.',
      });
    }

    res.status(200).json({
      success: true,
      message: `Vendor ${status} successfully.`,
      data: { vendor },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateVendorPayoutAccount = async (req, res) => {
  try {
    const accountId = String(req.body.razorpayAccountId || '').trim();
    if (accountId && !/^acc_[A-Za-z0-9]+$/.test(accountId)) {
      return res.status(400).json({
        success: false,
        message: 'Provide a valid Razorpay linked-account ID, or an empty value to unlink it.',
      });
    }
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { razorpayAccountId: accountId },
      { new: true, runValidators: true }
    ).select('-bankDetails');
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found.' });
    }
    return res.status(200).json({
      success: true,
      message: accountId ? 'Vendor payout account linked.' : 'Vendor payout account unlinked.',
      data: { vendor },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get vendor dashboard stats
// @route   GET /api/vendors/dashboard
// @access  Private (vendor)
exports.getVendorDashboard = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const Product = require('../models/Product');

    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found.',
      });
    }

    // Get products count
    const totalProducts = await Product.countDocuments({ vendor: req.user._id, isActive: true });
    const lowStockProducts = await Product.countDocuments({ vendor: req.user._id, stock: { $lte: 5, $gt: 0 } });
    const outOfStockProducts = await Product.countDocuments({ vendor: req.user._id, stock: 0 });

    // Get order stats
    const orders = await Order.find({ 'items.vendor': req.user._id });
    let totalRevenue = 0;
    let totalOrders = 0;
    let pendingOrders = 0;

    orders.forEach((order) => {
      order.items.forEach((item) => {
        if (item.vendor.toString() === req.user._id.toString()) {
          totalRevenue += item.price * item.quantity;
          totalOrders++;
          if (['placed', 'confirmed', 'packed'].includes(item.status)) {
            pendingOrders++;
          }
        }
      });
    });

    // Recent orders
    const recentOrders = await Order.find({ 'items.vendor': req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('customer', 'name email');

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totalProducts,
          lowStockProducts,
          outOfStockProducts,
          totalRevenue,
          totalOrders,
          pendingOrders,
          rating: vendor.rating,
          totalReviews: vendor.totalReviews,
        },
        recentOrders,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
