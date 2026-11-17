const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
exports.getCart = async (req, res) => {
  try {
    // Try cache first
    const cacheKey = `cart:${req.user._id}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    let cart = await Cart.findOne({ user: req.user._id }).populate(
      'items.product',
      'name slug price salePrice images stock isActive'
    );

    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    await cacheSet(cacheKey, cart, 1800);

    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Add item to cart
// @route   POST /api/cart/add
// @access  Private
exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const requestedQuantity = Number(quantity);
    if (!productId || !Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99) {
      return res.status(400).json({
        success: false,
        message: 'Provide a product and a quantity between 1 and 99.',
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This product is currently unavailable.',
      });
    }

    if (product.stock < requestedQuantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock.`,
      });
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }

    // Check if product already in cart
    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (existingItem) {
      existingItem.quantity += requestedQuantity;
      if (existingItem.quantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available in stock.`,
        });
      }
      existingItem.price = product.salePrice || product.price;
    } else {
      cart.items.push({
        product: productId,
        quantity: requestedQuantity,
        price: product.salePrice || product.price,
        name: product.name,
        image: product.images[0]?.url || '',
        vendor: product.vendor,
      });
    }

    await cart.save();

    // Populate for response
    cart = await Cart.findById(cart._id).populate(
      'items.product',
      'name slug price salePrice images stock isActive'
    );

    // Update cache
    await cacheSet(`cart:${req.user._id}`, cart, 1800);

    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update cart item quantity
// @route   PUT /api/cart/update
// @access  Private
exports.updateCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || !Number.isInteger(Number(quantity))) {
      return res.status(400).json({
        success: false,
        message: 'Provide a product and a whole-number quantity.',
      });
    }
    const nextQuantity = Number(quantity);
    if (nextQuantity > 99) {
      return res.status(400).json({ success: false, message: 'The maximum quantity per item is 99.' });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found.',
      });
    }

    const item = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart.',
      });
    }

    if (nextQuantity <= 0) {
      // Remove item
      cart.items = cart.items.filter(
        (item) => item.product.toString() !== productId
      );
    } else {
      const product = await Product.findById(productId);
      if (!product || !product.isActive) {
        return res.status(400).json({ success: false, message: 'This product is no longer available.' });
      }
      if (nextQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available.`,
        });
      }
      item.quantity = nextQuantity;
      item.price = product.salePrice || product.price;
    }

    await cart.save();
    cart = await Cart.findById(cart._id).populate(
      'items.product',
      'name slug price salePrice images stock isActive'
    );

    await cacheSet(`cart:${req.user._id}`, cart, 1800);

    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/remove/:productId
// @access  Private
exports.removeFromCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found.',
      });
    }

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== req.params.productId
    );

    await cart.save();
    cart = await Cart.findById(cart._id).populate(
      'items.product',
      'name slug price salePrice images stock isActive'
    );

    await cacheSet(`cart:${req.user._id}`, cart, 1800);

    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Clear entire cart
// @route   DELETE /api/cart/clear
// @access  Private
exports.clearCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id });
    if (cart) {
      cart.items = [];
      cart.couponCode = '';
      cart.couponDiscount = 0;
      await cart.save();
    }

    await cacheDel(`cart:${req.user._id}`);

    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
