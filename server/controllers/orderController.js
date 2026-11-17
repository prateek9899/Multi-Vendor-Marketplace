const crypto = require('crypto');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Vendor = require('../models/Vendor');
const { cacheDel } = require('../config/redis');
const { calculateCheckoutTotals, calculateCommission } = require('../utils/marketplaceMath');

const requestError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return null;
  }
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

const isValidAddress = (address) =>
  address &&
  ['fullName', 'phone', 'addressLine1', 'city', 'state', 'pincode'].every(
    (field) => typeof address[field] === 'string' && address[field].trim()
  );

const reserveStock = async (items) => {
  const reserved = [];
  for (const item of items) {
    const updated = await Product.findOneAndUpdate(
      { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity, totalSold: item.quantity } },
      { new: true }
    );
    if (!updated) {
      await releaseStock(reserved);
      throw requestError(`Not enough stock is available for "${item.name}".`, 409);
    }
    reserved.push(item);
  }
  return reserved;
};

const releaseStock = async (items) => {
  for (const item of items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity, totalSold: -item.quantity },
    });
  }
};

const getDiscount = async (code, userId, itemsTotal) => {
  if (!code) return { discount: 0, coupon: null };
  const coupon = await Coupon.findOne({
    code: String(code).trim().toUpperCase(),
    isActive: true,
    validFrom: { $lte: new Date() },
    validUntil: { $gte: new Date() },
  });
  if (!coupon) throw requestError('Invalid or expired coupon code.');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw requestError('Coupon usage limit reached.');
  }
  const usedByUser = coupon.usedBy.filter((id) => id.toString() === userId.toString()).length;
  if (usedByUser >= coupon.perUserLimit) throw requestError('You have already used this coupon.');
  if (itemsTotal < coupon.minOrderAmount) {
    throw requestError(`Minimum order amount for this coupon is ₹${coupon.minOrderAmount}.`);
  }
  let discount = coupon.discountType === 'percentage'
    ? (itemsTotal * coupon.discountValue) / 100
    : coupon.discountValue;
  if (coupon.discountType === 'percentage' && coupon.maxDiscount) {
    discount = Math.min(discount, coupon.maxDiscount);
  }
  return { discount: Math.min(itemsTotal, Math.round(discount * 100) / 100), coupon };
};

const sendFailure = (res, error) => {
  const status = error.statusCode || (error.name === 'ValidationError' || error.code === 11000 ? 400 : 500);
  return res.status(status).json({ success: false, message: error.message });
};

exports.createOrder = async (req, res) => {
  let reservedItems = [];
  let couponReserved = false;
  let couponId = null;
  let couponUserId = null;
  let createdOrderId = null;
  try {
    const {
      shippingAddress,
      paymentMethod = 'razorpay',
      couponCode,
      orderNotes = '',
    } = req.body;

    if (!isValidAddress(shippingAddress)) {
      return res.status(400).json({
        success: false,
        message: 'A complete shipping address is required.',
      });
    }
    if (!['razorpay', 'cod'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Choose Razorpay or cash on delivery.',
      });
    }
    const razorpay = paymentMethod === 'razorpay' ? getRazorpay() : null;
    if (paymentMethod === 'razorpay' && !razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Online payments are not configured. Choose cash on delivery or configure Razorpay test credentials.',
      });
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    const orderItems = [];
    let itemsTotal = 0;
    for (const cartItem of cart.items) {
      const product = cartItem.product;
      if (!product || !product.isActive) {
        return res.status(400).json({
          success: false,
          message: `Product "${cartItem.name}" is no longer available.`,
        });
      }
      if (product.stock < cartItem.quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units of "${product.name}" are available.`,
        });
      }
      const price = product.salePrice !== null && product.salePrice < product.price
        ? product.salePrice
        : product.price;
      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.images[0]?.url || '',
        price,
        quantity: cartItem.quantity,
        vendor: product.vendor,
        vendorStore: product.vendorStore,
      });
      itemsTotal += price * cartItem.quantity;
    }

    const { discount, coupon } = await getDiscount(couponCode, req.user._id, itemsTotal);
    const totals = calculateCheckoutTotals(itemsTotal, discount);
    const { shippingCharge, tax, totalAmount } = totals;
    if (totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'The order total must be greater than zero.' });
    }

    let razorpayOrder = null;
    if (razorpay) {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(totalAmount * 100),
        currency: 'INR',
        receipt: `mkt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        notes: { customerId: req.user._id.toString() },
      });
    }

    reservedItems = await reserveStock(orderItems);
    const order = await Order.create({
      customer: req.user._id,
      items: orderItems,
      shippingAddress,
      paymentInfo: {
        method: paymentMethod,
        status: 'pending',
        razorpayOrderId: razorpayOrder?.id,
      },
      itemsTotal,
      shippingCharge,
      tax,
      discount,
      totalAmount,
      couponCode: coupon?.code || '',
      orderNotes: String(orderNotes).slice(0, 1000),
    });
    createdOrderId = order._id;

    if (coupon) {
      const conditions = {
        _id: coupon._id,
        isActive: true,
        usedBy: { $ne: req.user._id },
      };
      if (coupon.usageLimit !== null) conditions.usedCount = { $lt: coupon.usageLimit };
      const updatedCoupon = await Coupon.findOneAndUpdate(
        conditions,
        { $inc: { usedCount: 1 }, $addToSet: { usedBy: req.user._id } },
        { new: true }
      );
      if (!updatedCoupon) {
        await Order.findByIdAndDelete(order._id);
        await releaseStock(reservedItems);
        reservedItems = [];
        return res.status(409).json({
          success: false,
          message: 'This coupon was just used or reached its limit. Please retry checkout without it.',
        });
      }
      couponReserved = true;
      couponId = coupon._id;
      couponUserId = req.user._id;
    }

    cart.items = [];
    cart.couponCode = '';
    cart.couponDiscount = 0;
    await cart.save();
    await cacheDel(`cart:${req.user._id}`);
    reservedItems = [];
    createdOrderId = null;

    return res.status(201).json({
      success: true,
      message: paymentMethod === 'cod' ? 'Order placed successfully.' : 'Payment order created.',
      data: {
        order,
        razorpayOrder,
        razorpayKeyId: razorpay ? process.env.RAZORPAY_KEY_ID : undefined,
      },
    });
  } catch (error) {
    if (createdOrderId) {
      await Order.findByIdAndDelete(createdOrderId);
    }
    if (reservedItems.length) {
      await releaseStock(reservedItems);
    }
    if (couponReserved) {
      await Coupon.findByIdAndUpdate(couponId, {
        $inc: { usedCount: -1 },
        $pull: { usedBy: couponUserId },
      });
    }
    return sendFailure(res, error);
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;
    if (![razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId].every((value) => typeof value === 'string' && value)) {
      return res.status(400).json({ success: false, message: 'All Razorpay payment fields are required.' });
    }
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ success: false, message: 'Razorpay is not configured.' });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'This order does not belong to your account.' });
    }
    if (!order.paymentInfo.razorpayOrderId || order.paymentInfo.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ success: false, message: 'Payment order does not match this order.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest();
    const providedSignature = Buffer.from(razorpaySignature, 'hex');
    if (providedSignature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(expectedSignature, providedSignature)) {
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }
    if (order.paymentInfo.status === 'paid') {
      if (order.paymentInfo.razorpayPaymentId !== razorpayPaymentId) {
        return res.status(409).json({ success: false, message: 'A different payment is already recorded for this order.' });
      }
      return res.status(200).json({ success: true, message: 'Payment was already verified.', data: { order } });
    }
    if (order.orderStatus === 'cancelled') {
      return res.status(409).json({ success: false, message: 'This order was cancelled and cannot be paid.' });
    }

    const vendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
    const vendors = await Vendor.find({ user: { $in: vendorIds } }).select('user commissionRate razorpayAccountId');
    const vendorByUser = new Map(vendors.map((vendor) => [vendor.user.toString(), vendor]));
    const totalsByVendor = new Map();
    for (const item of order.items) {
      const key = item.vendor.toString();
      totalsByVendor.set(key, (totalsByVendor.get(key) || 0) + item.price * item.quantity);
    }
    const payoutLines = [...totalsByVendor].map(([vendorUserId, gross]) => {
      const vendor = vendorByUser.get(vendorUserId);
      const rate = vendor ? vendor.commissionRate : Number(process.env.PLATFORM_COMMISSION_RATE || 10);
      const vendorDiscount = order.itemsTotal > 0
        ? Math.round((order.discount * gross / order.itemsTotal) * 100) / 100
        : 0;
      const netGross = Math.max(0, Math.round((gross - vendorDiscount) * 100) / 100);
      const { commission, payout } = calculateCommission(netGross, rate);
      return {
        vendor,
        gross: netGross,
        commission,
        payout: Math.round(payout * 100),
      };
    });

    order.paymentInfo.razorpayPaymentId = razorpayPaymentId;
    order.paymentInfo.razorpaySignature = razorpaySignature;
    order.paymentInfo.status = 'paid';
    order.paymentInfo.paidAt = new Date();
    order.paymentInfo.commissionTotal = Math.round(
      payoutLines.reduce((total, line) => total + line.commission, 0) * 100
    ) / 100;
    order.orderStatus = 'processing';

    const everyVendorConnected = payoutLines.length > 0 &&
      payoutLines.every((line) => line.vendor?.razorpayAccountId);
    if (!everyVendorConnected) {
      order.paymentInfo.transferStatus = 'pending_setup';
      order.paymentInfo.transfers = payoutLines.map((line) => ({
        vendor: line.vendor?._id,
        accountId: line.vendor?.razorpayAccountId || '',
        amount: line.payout,
      }));
      await order.save();
      return res.status(200).json({
        success: true,
        message: 'Payment verified. Vendor split payouts are pending linked Razorpay accounts.',
        data: { order, transferStatus: 'pending_setup' },
      });
    }

    order.paymentInfo.transferStatus = 'pending_transfer';
    order.paymentInfo.transfers = payoutLines.map((line) => ({
      vendor: line.vendor._id,
      accountId: line.vendor.razorpayAccountId,
      amount: line.payout,
    }));
    await order.save();

    try {
      const razorpay = getRazorpay();
      const transferResult = await razorpay.payments.transfer(razorpayPaymentId, {
        transfers: payoutLines.map((line) => ({
          account: line.vendor.razorpayAccountId,
          amount: line.payout,
          currency: 'INR',
          notes: { orderId: order._id.toString() },
          on_hold: false,
        })),
      });
      const transfers = Array.isArray(transferResult) ? transferResult : transferResult.items || [];
      order.paymentInfo.transfers = order.paymentInfo.transfers.map((transfer, index) => ({
        ...transfer.toObject(),
        transferId: transfers[index]?.id || '',
      }));
      order.paymentInfo.transferStatus = 'transferred';
      await order.save();
    } catch (transferError) {
      console.error('Razorpay vendor transfer requires reconciliation:', transferError.message);
      return res.status(200).json({
        success: true,
        message: 'Payment verified. Vendor payouts need reconciliation in the Razorpay dashboard.',
        data: { order, transferStatus: 'pending_transfer' },
      });
    }

    for (const line of payoutLines) {
      if (line.vendor) {
        await Vendor.findByIdAndUpdate(line.vendor._id, {
          $inc: {
            totalRevenue: Math.round((line.gross - line.commission) * 100) / 100,
            totalSales: order.items
              .filter((item) => item.vendor.toString() === line.vendor.user.toString())
              .reduce((sum, item) => sum + item.quantity, 0),
          },
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and vendor payouts submitted.',
      data: { order, transferStatus: order.paymentInfo.transferStatus },
    });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const query = { customer: req.user._id };
    if (req.query.status) query.orderStatus = req.query.status;
    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      data: { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name slug images');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const isCustomer = order.customer._id.toString() === req.user._id.toString();
    const isVendor = order.items.some((item) => item.vendor.toString() === req.user._id.toString());
    if (!isCustomer && !isVendor && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to view this order.' });
    }
    return res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.updateItemStatus = async (req, res) => {
  try {
    const { status, trackingId } = req.body;
    const transitions = {
      placed: ['confirmed', 'packed'],
      confirmed: ['packed'],
      packed: ['shipped'],
      shipped: ['delivered'],
    };
    if (!['confirmed', 'packed', 'shipped', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid order item status.' });
    }
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Order item not found.' });
    if (item.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to update this item.' });
    }
    if (!(transitions[item.status] || []).includes(status)) {
      return res.status(409).json({ success: false, message: `Cannot move this item from ${item.status} to ${status}.` });
    }
    item.status = status;
    if (typeof trackingId === 'string') item.trackingId = trackingId.slice(0, 100);
    if (status === 'shipped') item.shippedAt = new Date();
    if (status === 'delivered') item.deliveredAt = new Date();

    const statuses = order.items.map((entry) => entry.status);
    if (statuses.every((value) => value === 'delivered')) order.orderStatus = 'delivered';
    else if (statuses.every((value) => value === 'cancelled')) order.orderStatus = 'cancelled';
    else if (statuses.some((value) => value === 'shipped')) order.orderStatus = 'shipped';
    else if (statuses.some((value) => ['confirmed', 'packed'].includes(value))) order.orderStatus = 'processing';
    await order.save();
    return res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this order.' });
    }
    if (['delivered', 'cancelled', 'shipped'].includes(order.orderStatus)) {
      return res.status(409).json({ success: false, message: `Cannot cancel an order that is ${order.orderStatus}.` });
    }
    if (order.paymentInfo.status === 'paid') {
      return res.status(409).json({
        success: false,
        message: 'This paid order needs a refund before cancellation. Contact support; automatic refunds are not configured.',
      });
    }
    const cancelledOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        customer: order.customer,
        orderStatus: { $in: ['placed', 'processing'] },
        'paymentInfo.status': { $ne: 'paid' },
      },
      { $set: { orderStatus: 'cancelled', cancelReason: String(req.body.reason || '').slice(0, 500) } },
      { new: true }
    );
    if (!cancelledOrder) {
      return res.status(409).json({ success: false, message: 'This order can no longer be cancelled.' });
    }
    order.cancelReason = String(req.body.reason || '').slice(0, 500);
    order.items.forEach((item) => {
      if (!['delivered', 'cancelled'].includes(item.status)) item.status = 'cancelled';
    });
    await releaseStock(order.items);
    order.orderStatus = 'cancelled';
    await order.save();
    return res.status(200).json({ success: true, message: 'Order cancelled.', data: { order } });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.getVendorOrders = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const itemQuery = { vendor: req.user._id };
    if (req.query.status) itemQuery.status = req.query.status;
    const query = { items: { $elemMatch: itemQuery } };
    const [orders, total] = await Promise.all([
      Order.find(query).populate('customer', 'name email phone').sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit),
      Order.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      data: { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    });
  } catch (error) {
    return sendFailure(res, error);
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = {};
    if (req.query.status) query.orderStatus = req.query.status;
    if (req.query.search) query.orderNumber = new RegExp(
      String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100),
      'i'
    );
    const [orders, total] = await Promise.all([
      Order.find(query).populate('customer', 'name email').sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit),
      Order.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      data: { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    });
  } catch (error) {
    return sendFailure(res, error);
  }
};
