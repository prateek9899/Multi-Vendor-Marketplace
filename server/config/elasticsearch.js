const { Client } = require('@elastic/elasticsearch');

let esClient;

const connectElasticsearch = async () => {
  try {
    esClient = new Client({
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    });

    // Test connection
    const info = await esClient.info();
    console.log(`Elasticsearch Connected: ${info.name}`);

    // Create product index if not exists
    const indexExists = await esClient.indices.exists({ index: 'products' });
    if (!indexExists) {
      await esClient.indices.create({
        index: 'products',
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                product_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'stop', 'snowball'],
                },
              },
            },
          },
          mappings: {
            properties: {
              name: { type: 'text', analyzer: 'product_analyzer', boost: 2 },
              description: { type: 'text', analyzer: 'product_analyzer' },
              category: { type: 'keyword' },
              subcategory: { type: 'keyword' },
              brand: { type: 'keyword' },
              price: { type: 'float' },
              salePrice: { type: 'float' },
              rating: { type: 'float' },
              reviewCount: { type: 'integer' },
              vendor: { type: 'keyword' },
              vendorName: { type: 'text' },
              tags: { type: 'keyword' },
              inStock: { type: 'boolean' },
              createdAt: { type: 'date' },
            },
          },
        },
      });
      console.log('Elasticsearch: products index created');
    }
  } catch (error) {
    console.warn('Elasticsearch connection error (search will use MongoDB fallback):', error.message);
    esClient = null;
  }
};

const getESClient = () => esClient;

// Index a product
const indexProduct = async (product) => {
  if (!esClient) return;
  try {
    await esClient.index({
      index: 'products',
      id: product._id.toString(),
      body: {
        name: product.name,
        description: product.description,
        category: product.category,
        subcategory: product.subcategory,
        brand: product.brand,
        price: product.price,
        salePrice: product.salePrice,
        rating: product.rating,
        reviewCount: product.reviewCount,
        vendor: product.vendor.toString(),
        vendorName: product.vendorName,
        tags: product.tags,
        inStock: product.stock > 0,
        createdAt: product.createdAt,
      },
    });
  } catch (error) {
    console.warn('ES index error:', error.message);
  }
};

// Remove product from index
const removeProductIndex = async (productId) => {
  if (!esClient) return;
  try {
    await esClient.delete({
      index: 'products',
      id: productId.toString(),
    });
  } catch (error) {
    console.warn('ES delete error:', error.message);
  }
};

// Search products
const searchProducts = async (query, filters = {}, page = 1, limit = 20) => {
  if (!esClient) return null; // Fallback to MongoDB search

  try {
    const must = [];
    const filter = [];

    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['name^3', 'description', 'brand^2', 'tags^2'],
          fuzziness: 'AUTO',
        },
      });
    }

    if (filters.category) {
      filter.push({ term: { category: filters.category } });
    }
    if (filters.subcategory) {
      filter.push({ term: { subcategory: filters.subcategory } });
    }
    if (filters.brand) {
      filter.push({ term: { brand: filters.brand } });
    }
    if (filters.minPrice || filters.maxPrice) {
      const range = {};
      if (filters.minPrice) range.gte = parseFloat(filters.minPrice);
      if (filters.maxPrice) range.lte = parseFloat(filters.maxPrice);
      filter.push({ range: { price: range } });
    }
    if (filters.minRating) {
      filter.push({ range: { rating: { gte: parseFloat(filters.minRating) } } });
    }
    if (filters.inStock !== undefined) {
      filter.push({ term: { inStock: filters.inStock } });
    }

    // Sort options
    let sort = [];
    switch (filters.sortBy) {
      case 'price_asc':
        sort = [{ price: 'asc' }];
        break;
      case 'price_desc':
        sort = [{ price: 'desc' }];
        break;
      case 'rating':
        sort = [{ rating: 'desc' }];
        break;
      case 'newest':
        sort = [{ createdAt: 'desc' }];
        break;
      default:
        if (query) sort = ['_score'];
        else sort = [{ createdAt: 'desc' }];
    }

    const result = await esClient.search({
      index: 'products',
      body: {
        from: (page - 1) * limit,
        size: limit,
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
            filter,
          },
        },
        sort,
        aggs: {
          categories: { terms: { field: 'category', size: 50 } },
          brands: { terms: { field: 'brand', size: 50 } },
          price_stats: { stats: { field: 'price' } },
          avg_rating: { avg: { field: 'rating' } },
        },
      },
    });

    return {
      hits: result.hits.hits.map((hit) => ({
        _id: hit._id,
        ...hit._source,
        score: hit._score,
      })),
      total: result.hits.total.value,
      aggregations: result.aggregations,
    };
  } catch (error) {
    console.warn('ES search error:', error.message);
    return null;
  }
};

module.exports = {
  connectElasticsearch,
  getESClient,
  indexProduct,
  removeProductIndex,
  searchProducts,
};
