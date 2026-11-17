require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = require('./app');
const connectDB = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const { connectElasticsearch } = require('./config/elasticsearch');

const port = Number(process.env.PORT) || 5000;

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured.');
  if (process.env.NODE_ENV === 'production') {
    for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      if (!process.env[name] || process.env[name].length < 32) {
        throw new Error(`${name} must be at least 32 characters in production.`);
      }
    }
  } else {
    for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      if (!process.env[name]) {
        console.warn(`${name} is missing; authentication routes will not be usable.`);
      }
    }
  }

  await connectDB();
  connectRedis();
  await connectElasticsearch();

  const server = app.listen(port, () => {
    console.log(`Marketplace API listening on http://localhost:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; closing marketplace server.`);
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('Marketplace startup failed:', error.message);
  process.exitCode = 1;
});
