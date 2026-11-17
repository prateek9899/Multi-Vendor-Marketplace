const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const { uploadToS3, deleteFromS3 } = require('../config/s3');
const { indexProduct, removeProductIndex, searchProducts } = require('../config/elasticsearch');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../config/redis');

const parseList = (value, label) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid JSON array.`);
  }
};

const editableFields = [
  'name',
  'description',
  'shortDescription',
  'price',
  'salePrice',
  'category',
  'subcategory',
  'brand',
  'stock',
  'sku',
  'specifications',
  'tags',
  'weight',
  'dimensions',
  'isActive',
  'isFeatured',
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Create a product
// @route   POST /api/products
// @access  Private (vendor)
exports.createProduct = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor || vendor.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your vendor account must be approved to add products.',
      });
    }

    const productData = Object.fromEntries(
      editableFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]])
    );
    productData.vendor = req.user._id;
    productData.vendorStore = vendor._id;
    productData.vendorName = vendor.storeName;

    // Handle image uploads
    if (req.files && req.files.length > 0) {
      const imagePromises = req.files.map(async (file, index) => {
        const result = await uploadToS3(file, 'products');
        return {
          url: result.url,
          key: result.key,
          alt: req.body.name,
          isPrimary: index === 0,
        };
      });
      productData.images = await Promise.all(imagePromises);
    } else if (req.body.images) {
      // Accept images as URL array (for seeding/testing)
      productData.images = Array.isArray(req.body.images)
        ? req.body.images.map((img, i) => ({
            url: typeof img === 'string' ? img : img.url,
            key: img.key || '',
            alt: req.body.name,
            isPrimary: i === 0,
          }))
        : [{ url: req.body.images, key: '', alt: req.body.name, isPrimary: true }];
    }

    // Parse specifications if string
    if (req.body.specifications !== undefined) {
      productData.specifications = parseList(req.body.specifications, 'Specifications');
    }

    // Parse tags if string
    if (typeof req.body.tags === 'string') productData.tags = req.body.tags.split(',').map((tag) => tag.trim()).filter(Boolean);

    const product = await Product.create(productData);

    // Update vendor product count
    await Vendor.findByIdAndUpdate(vendor._id, { $inc: { totalProducts: 1 } });

    // Index in Elasticsearch
    await indexProduct(product);

    // Clear cache
    await cacheDelPattern('products:*');

    res.status(201).json({
      success: true,
      message: 'Product created successfully!',
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all products (with search, filters, sorting)
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      subcategory,
      brand,
      minPrice,
      maxPrice,
      minRating,
      sortBy,
      vendor,
      inStock,
    } = req.query;
    const pageNumber = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    // Try cache first
    const cacheKey = `products:${JSON.stringify(req.query)}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    // Try Elasticsearch first
    if (search) {
      const esResults = await searchProducts(
        search,
        { category, subcategory, brand, minPrice, maxPrice, minRating, sortBy, inStock: inStock === 'true' },
        pageNumber,
        pageLimit
      );

      if (esResults) {
        const productIds = esResults.hits.map((h) => h._id);
        const products = await Product.find({ _id: { $in: productIds }, isActive: true })
          .populate('vendor', 'name')
          .populate('vendorStore', 'storeName slug rating');
        const byId = new Map(products.map((product) => [product._id.toString(), product]));
        const orderedProducts = productIds.map((id) => byId.get(id)).filter(Boolean);

        const result = {
          products: orderedProducts,
          pagination: {
            page: pageNumber,
            limit: pageLimit,
            total: esResults.total,
            pages: Math.ceil(esResults.total / pageLimit),
          },
          aggregations: esResults.aggregations,
        };

        await cacheSet(cacheKey, result, 300); // Cache for 5 min
        return res.status(200).json({ success: true, data: result });
      }
    }

    // Fallback to MongoDB
    const query = { isActive: true };

    if (search) {
      query.$text = { $search: String(search).slice(0, 100) };
    }
    if (category) query.category = category;
    if (subcategory) query.subcategory = subcategory;
    if (brand) query.brand = brand;
    if (vendor) query.vendor = vendor;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    if (minRating) query.rating = { $gte: Number(minRating) };
    if (inStock === 'true') query.stock = { $gt: 0 };

    // Sort options
    let sort = {};
    switch (sortBy) {
      case 'price_asc':
        sort = { price: 1 };
        break;
      case 'price_desc':
        sort = { price: -1 };
        break;
      case 'rating':
        sort = { rating: -1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'bestselling':
        sort = { totalSold: -1 };
        break;
      default:
        sort = search ? { score: { $meta: 'textScore' } } : { createdAt: -1 };
    }

    const products = await Product.find(query)
      .populate('vendor', 'name')
      .populate('vendorStore', 'storeName slug rating')
      .sort(sort)
      .skip((pageNumber - 1) * pageLimit)
      .limit(pageLimit);

    const total = await Product.countDocuments(query);

    // Get aggregations from MongoDB
    const aggregations = await Product.aggregate([
      { $match: { isActive: true } },
      {
        $facet: {
          categories: [{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          brands: [{ $match: { brand: { $ne: '' } } }, { $group: { _id: '$brand', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 30 }],
          priceRange: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' }, avg: { $avg: '$price' } } }],
        },
      },
    ]);

    const result = {
      products,
      pagination: {
        page: pageNumber,
        limit: pageLimit,
        total,
        pages: Math.ceil(total / pageLimit),
      },
      aggregations: aggregations[0],
    };

    await cacheSet(cacheKey, result, 300);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single product by slug
// @route   GET /api/products/:slug
// @access  Public
exports.getProduct = async (req, res) => {
  try {
    const cacheKey = `product:${req.params.slug}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    const identifierQuery = /^[0-9a-fA-F]{24}$/.test(req.params.slug)
      ? { $or: [{ slug: req.params.slug }, { _id: req.params.slug }] }
      : { slug: req.params.slug };
    const product = await Product.findOne({ ...identifierQuery, isActive: true })
      .populate('vendor', 'name')
      .populate('vendorStore', 'storeName slug rating storeLogo');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Get related products
    const relatedProducts = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
      isActive: true,
    })
      .limit(8)
      .select('name slug price salePrice images rating reviewCount');

    const data = { product, relatedProducts };
    await cacheSet(cacheKey, data, 600);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private (vendor - owner)
exports.updateProduct = async (req, res) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Check ownership
    if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product.',
      });
    }

    const updates = Object.fromEntries(
      editableFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]])
    );
    if (typeof updates.tags === 'string') updates.tags = updates.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (updates.specifications !== undefined) {
      updates.specifications = parseList(updates.specifications, 'Specifications');
    }
    if (req.files && req.files.length > 0) {
      const newImages = await Promise.all(req.files.map(async (file) => {
        const result = await uploadToS3(file, 'products');
        return { url: result.url, key: result.key, alt: updates.name || product.name, isPrimary: false };
      }));
      updates.images = [...(product.images || []), ...newImages];
    }
    if (updates.salePrice === '') updates.salePrice = null;
    product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    // Re-index in Elasticsearch
    await indexProduct(product);

    // Clear cache
    await cacheDel(`product:${product.slug}`);
    await cacheDelPattern('products:*');

    res.status(200).json({
      success: true,
      data: { product },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private (vendor - owner, admin)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this product.',
      });
    }

    // Delete images from S3
    for (const img of product.images) {
      if (img.key) await deleteFromS3(img.key);
    }

    await Product.findByIdAndDelete(req.params.id);

    // Update vendor product count
    await Vendor.findOneAndUpdate({ user: product.vendor }, { $inc: { totalProducts: -1 } });

    // Remove from Elasticsearch
    await removeProductIndex(req.params.id);

    // Clear cache
    await cacheDel(`product:${product.slug}`);
    await cacheDelPattern('products:*');

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get vendor's own products
// @route   GET /api/products/vendor/my-products
// @access  Private (vendor)
exports.getVendorProducts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const query = { vendor: req.user._id };

    if (search) {
    const safeSearch = escapeRegex(String(search).slice(0, 100));
    query.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { sku: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (category) query.category = category;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        products,
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

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
exports.getFeaturedProducts = async (req, res) => {
  try {
    const cacheKey = 'products:featured';
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    const products = await Product.find({ isFeatured: true, isActive: true })
      .populate('vendorStore', 'storeName slug')
      .limit(20)
      .sort({ rating: -1 });

    await cacheSet(cacheKey, products, 600);

    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get product categories
// @route   GET /api/products/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const cacheKey = 'products:categories';
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    const categories = await Product.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          subcategories: { $addToSet: '$subcategory' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    await cacheSet(cacheKey, categories, 3600);

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
