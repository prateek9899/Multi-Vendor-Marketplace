const Coupon = require('../models/Coupon');

// @desc    Create coupon
// @route   POST /api/coupons
// @access  Private (admin)
exports.createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create({
      ...req.body,
      validFrom: req.body.validFrom || new Date(),
      validUntil: req.body.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      data: { coupon },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Private (admin)
exports.getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: coupons,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Validate & apply coupon
// @route   POST /api/coupons/validate
// @access  Private
exports.validateCoupon = async (req, res) => {
  try {
    const { code, cartTotal } = req.body;
    const total = Number(cartTotal);
    if (typeof code !== 'string' || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide a coupon code and a valid cart total.',
      });
    }

    const coupon = await Coupon.findOne({
      code: code.trim().toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired coupon code.',
      });
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        message: 'Coupon usage limit reached.',
      });
    }

    // Check per-user limit
    const userUsageCount = coupon.usedBy.filter(
      (id) => id.toString() === req.user._id.toString()
    ).length;
    if (userUsageCount >= coupon.perUserLimit) {
      return res.status(400).json({
        success: false,
        message: 'You have already used this coupon.',
      });
    }

    if (total < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount is ₹${coupon.minOrderAmount}.`,
      });
    }

    let discount;
    if (coupon.discountType === 'percentage') {
      discount = (total * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.discountValue;
    }
    discount = Math.min(total, Math.round(discount * 100) / 100);

    res.status(200).json({
      success: true,
      data: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discount,
        description: coupon.description,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private (admin)
exports.updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found.',
      });
    }

    res.status(200).json({
      success: true,
      data: { coupon },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Private (admin)
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Coupon deleted.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
