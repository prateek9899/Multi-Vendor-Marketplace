const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const { uploadMultiple, uploadSingle } = require('../middleware/upload');
const auth = require('../controllers/authController');
const products = require('../controllers/productController');
const cart = require('../controllers/cartController');
const orders = require('../controllers/orderController');
const vendors = require('../controllers/vendorController');
const reviews = require('../controllers/reviewController');
const coupons = require('../controllers/couponController');
const { getAdminAnalytics } = require('../controllers/adminController');
const { downloadInvoice } = require('../controllers/invoiceController');

const router = express.Router();

router.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const { getRedis } = require('../config/redis');
  const redis = getRedis();
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    success: mongoose.connection.readyState === 1,
    data: {
      status: mongoose.connection.readyState === 1 ? 'ok' : 'database_unavailable',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redis && redis.status === 'ready' ? 'connected' : 'memory_fallback',
      search: require('../config/elasticsearch').getESClient() ? 'connected' : 'mongodb_fallback',
    },
  });
});

router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/refresh', auth.refreshToken);
router.get('/auth/me', protect, auth.getMe);
router.post('/auth/logout', protect, auth.logout);
router.put('/auth/profile', protect, auth.updateProfile);
router.put('/auth/password', protect, auth.updatePassword);
router.post('/auth/address', protect, auth.addAddress);
router.delete('/auth/address/:addressId', protect, auth.deleteAddress);
router.post('/auth/wishlist/:productId', protect, auth.toggleWishlist);

router.get('/products', products.getProducts);
router.get('/products/featured', products.getFeaturedProducts);
router.get('/products/categories', products.getCategories);
router.get('/products/vendor/my-products', protect, authorize('vendor', 'admin'), products.getVendorProducts);
router.post('/products', protect, authorize('vendor', 'admin'), uploadMultiple, products.createProduct);
router.get('/products/:slug', products.getProduct);
router.put('/products/:id', protect, authorize('vendor', 'admin'), uploadMultiple, products.updateProduct);
router.delete('/products/:id', protect, authorize('vendor', 'admin'), products.deleteProduct);

router.get('/vendors/store/:slug', vendors.getVendorStore);
router.post('/vendors/register', protect, vendors.registerVendor);
router.get('/vendors/profile', protect, authorize('vendor'), vendors.getVendorProfile);
router.put('/vendors/profile', protect, authorize('vendor'), vendors.updateVendorProfile);
router.post('/vendors/upload-logo', protect, authorize('vendor'), uploadSingle, vendors.uploadStoreLogo);
router.get('/vendors/dashboard', protect, authorize('vendor'), vendors.getVendorDashboard);
router.get('/vendors', protect, authorize('admin'), vendors.getAllVendors);
router.put('/vendors/:id/status', protect, authorize('admin'), vendors.updateVendorStatus);
router.put('/vendors/:id/payout-account', protect, authorize('admin'), vendors.updateVendorPayoutAccount);

router.get('/cart', protect, cart.getCart);
router.post('/cart/add', protect, cart.addToCart);
router.put('/cart/update', protect, cart.updateCartItem);
router.delete('/cart/remove/:productId', protect, cart.removeFromCart);
router.delete('/cart/clear', protect, cart.clearCart);

router.post('/orders', protect, orders.createOrder);
router.post('/orders/verify-payment', protect, orders.verifyPayment);
router.get('/orders/my-orders', protect, orders.getMyOrders);
router.get('/orders/vendor-orders', protect, authorize('vendor', 'admin'), orders.getVendorOrders);
router.get('/orders/admin/all', protect, authorize('admin'), orders.getAllOrders);
router.get('/orders/:id/invoice', protect, downloadInvoice);
router.get('/orders/:id', protect, orders.getOrder);
router.put('/orders/:id/cancel', protect, orders.cancelOrder);
router.put('/orders/:orderId/items/:itemId/status', protect, authorize('vendor', 'admin'), orders.updateItemStatus);

router.get('/reviews/product/:productId', reviews.getProductReviews);
router.post('/reviews', protect, reviews.createReview);
router.post('/reviews/:id/helpful', protect, reviews.markHelpful);
router.delete('/reviews/:id', protect, reviews.deleteReview);

router.get('/coupons', protect, authorize('admin'), coupons.getCoupons);
router.post('/coupons/validate', protect, coupons.validateCoupon);
router.post('/coupons', protect, authorize('admin'), coupons.createCoupon);
router.put('/coupons/:id', protect, authorize('admin'), coupons.updateCoupon);
router.delete('/coupons/:id', protect, authorize('admin'), coupons.deleteCoupon);
router.get('/admin/analytics', protect, authorize('admin'), getAdminAnalytics);

module.exports = router;
