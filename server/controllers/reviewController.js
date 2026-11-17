const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');

// @desc    Create a review
// @route   POST /api/reviews
// @access  Private
exports.createReview = async (req, res) => {
  try {
    const { productId, rating, title, comment } = req.body;
    if (!productId || !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5 || !comment?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A product, a 1–5 star rating, and a review comment are required.',
      });
    }

    const product = await Product.findOne({ _id: productId, isActive: true });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Check if already reviewed
    const existingReview = await Review.findOne({
      product: productId,
      user: req.user._id,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product.',
      });
    }

    // Check if user purchased this product
    const hasPurchased = await Order.findOne({
      customer: req.user._id,
      items: {
        $elemMatch: {
          product: productId,
          status: 'delivered',
        },
      },
    });

    const review = await Review.create({
      product: productId,
      user: req.user._id,
      userName: req.user.name,
      rating: Number(rating),
      title,
      comment,
      isVerifiedPurchase: !!hasPurchased,
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully!',
      data: { review },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10, sort = 'newest' } = req.query;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
      return res.status(200).json({
        success: true,
        data: {
          reviews: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 0 },
          ratingBreakdown: [],
        },
      });
    }

    let sortQuery;
    switch (sort) {
      case 'highest':
        sortQuery = { rating: -1 };
        break;
      case 'lowest':
        sortQuery = { rating: 1 };
        break;
      case 'helpful':
        sortQuery = { helpfulCount: -1 };
        break;
      default:
        sortQuery = { createdAt: -1 };
    }

    const pageNumber = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const reviews = await Review.find({
      product: req.params.productId,
      isActive: true,
    })
      .populate('user', 'name avatar')
      .sort(sortQuery)
      .skip((pageNumber - 1) * pageLimit)
      .limit(pageLimit);

    const total = await Review.countDocuments({
      product: req.params.productId,
      isActive: true,
    });

    // Rating breakdown
    const ratingBreakdown = await Review.aggregate([
      { $match: { product: new (require('mongoose').Types.ObjectId)(req.params.productId), isActive: true } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: pageNumber,
          limit: pageLimit,
          total,
          pages: Math.ceil(total / pageLimit),
        },
        ratingBreakdown,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Mark review as helpful
// @route   POST /api/reviews/:id/helpful
// @access  Private
exports.markHelpful = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found.',
      });
    }

    const userId = req.user._id;
    const alreadyVoted = review.helpfulVotes.some((id) => id.toString() === userId.toString());

    if (alreadyVoted) {
      review.helpfulVotes = review.helpfulVotes.filter(
        (id) => id.toString() !== userId.toString()
      );
      review.helpfulCount -= 1;
    } else {
      review.helpfulVotes.push(userId);
      review.helpfulCount += 1;
    }

    await review.save();

    res.status(200).json({
      success: true,
      data: { helpfulCount: review.helpfulCount },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private (owner or admin)
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found.',
      });
    }

    if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review.',
      });
    }

    const productId = review.product;
    await Review.findByIdAndDelete(req.params.id);

    // Recalculate rating
    await Review.calcAverageRating(productId);

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
