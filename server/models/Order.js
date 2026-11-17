const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: String,
  image: String,
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  vendorStore: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
  },
  status: {
    type: String,
    enum: ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'placed',
  },
  trackingId: { type: String, default: '' },
  shippedAt: Date,
  deliveredAt: Date,
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: [orderItemSchema],
    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      addressLine1: { type: String, required: true },
      addressLine2: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: 'India' },
    },
    paymentInfo: {
      method: {
        type: String,
        enum: ['razorpay', 'cod', 'wallet'],
        default: 'razorpay',
      },
      razorpayOrderId: String,
      razorpayPaymentId: String,
      razorpaySignature: String,
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending',
      },
      commissionTotal: { type: Number, default: 0 },
      transferStatus: {
        type: String,
        enum: ['not_applicable', 'pending_setup', 'pending_transfer', 'transferred'],
        default: 'not_applicable',
      },
      transfers: [
        {
          vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
          accountId: String,
          amount: Number,
          transferId: String,
        },
      ],
      paidAt: Date,
    },
    itemsTotal: {
      type: Number,
      required: true,
    },
    shippingCharge: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    couponCode: {
      type: String,
      default: '',
    },
    orderStatus: {
      type: String,
      enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'placed',
    },
    orderNotes: {
      type: String,
      default: '',
    },
    cancelReason: {
      type: String,
      default: '',
    },
    invoiceUrl: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Generate order number
orderSchema.pre('validate', function (next) {
  if (!this.orderNumber) {
    this.orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  next();
});

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ 'items.vendor': 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
