const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    storeName: {
      type: String,
      required: [true, 'Store name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Store name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    storeDescription: {
      type: String,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: '',
    },
    storeLogo: {
      url: { type: String, default: '' },
      key: { type: String, default: '' },
    },
    storeBanner: {
      url: { type: String, default: '' },
      key: { type: String, default: '' },
    },
    businessInfo: {
      businessName: { type: String, default: '' },
      gstin: { type: String, default: '' },
      pan: { type: String, default: '' },
      businessType: {
        type: String,
        enum: ['individual', 'company', 'partnership', 'llp'],
        default: 'individual',
      },
      businessAddress: {
        addressLine1: String,
        addressLine2: String,
        city: String,
        state: String,
        pincode: String,
        country: { type: String, default: 'India' },
      },
    },
    bankDetails: {
      accountHolderName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      bankName: { type: String, default: '' },
    },
    razorpayAccountId: {
      type: String,
      default: '',
    },
    commissionRate: {
      type: Number,
      default: 10, // percentage
      min: 0,
      max: 50,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    totalProducts: {
      type: Number,
      default: 0,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

vendorSchema.index({ slug: 1 });
vendorSchema.index({ status: 1 });
vendorSchema.index({ rating: -1 });

module.exports = mongoose.model('Vendor', vendorSchema);
