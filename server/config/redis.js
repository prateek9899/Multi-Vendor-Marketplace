const Redis = require('ioredis');

let redis;

const connectRedis = () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(redisHost);
  const isUpstash = redisHost.includes('upstash.io');
  const allowRemote = process.env.ALLOW_REMOTE_REDIS === 'true' || isUpstash;
  if (!isLocalHost && !allowRemote) {
    console.warn('Remote Redis is disabled. Using process-local cache; set ALLOW_REMOTE_REDIS=true to opt in.');
    return null;
  }

  try {
    const options = {
      host: redisHost,
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      tls: isUpstash || process.env.REDIS_TLS === 'true' ? {} : undefined,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 5000,
    };
    redis = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, options)
      : new Redis(options);

    redis.on('connect', () => {
      console.log('Redis Connected');
    });

    redis.on('error', (err) => {
      console.warn('Redis Connection Error (will use fallback):', err.message);
    });

    redis.connect().catch((err) => {
      console.warn('Redis not available, using in-memory fallback:', err.message);
    });
  } catch (error) {
    console.warn('Redis initialization error, using in-memory fallback:', error.message);
  }

  return redis;
};

// In-memory fallback cache when Redis is unavailable
const memoryCache = new Map();
const memoryCacheTTL = new Map();

const getRedis = () => redis;

// Cache helper functions with Redis + in-memory fallback
const cacheGet = async (key) => {
  try {
    if (redis && redis.status === 'ready') {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    }
  } catch (err) {
    console.warn('Redis GET error, using memory cache:', err.message);
  }
  // Fallback to memory
  if (memoryCache.has(key)) {
    const ttl = memoryCacheTTL.get(key);
    if (ttl && Date.now() > ttl) {
      memoryCache.delete(key);
      memoryCacheTTL.delete(key);
      return null;
    }
    return memoryCache.get(key);
  }
  return null;
};

const cacheSet = async (key, value, ttlSeconds = 3600) => {
  try {
    if (redis && redis.status === 'ready') {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    }
  } catch (err) {
    console.warn('Redis SET error, using memory cache:', err.message);
  }
  // Fallback to memory
  memoryCache.set(key, value);
  memoryCacheTTL.set(key, Date.now() + ttlSeconds * 1000);
};

const cacheDel = async (key) => {
  try {
    if (redis && redis.status === 'ready') {
      await redis.del(key);
      return;
    }
  } catch (err) {
    console.warn('Redis DEL error:', err.message);
  }
  memoryCache.delete(key);
  memoryCacheTTL.delete(key);
};

const cacheDelPattern = async (pattern) => {
  try {
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return;
    }
  } catch (err) {
    console.warn('Redis DEL pattern error:', err.message);
  }
  // Fallback: delete matching keys from memory
  for (const key of memoryCache.keys()) {
    if (key.match(new RegExp(pattern.replace('*', '.*')))) {
      memoryCache.delete(key);
      memoryCacheTTL.delete(key);
    }
  }
};

const closeRedis = async () => {
  if (redis && redis.status !== 'end') {
    await redis.quit();
  }
};

module.exports = {
  connectRedis,
  getRedis,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  closeRedis,
};
