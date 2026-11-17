require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const mongoose = require('mongoose');
const slugify = require('slugify');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Product = require('../models/Product');

const seedProducts = [
  ['Studio wireless headphones with active noise cancelling', 'Electronics', 6499, 8999, 4.7, 1284, 'photo-1505740420928-5e560c06d30e', 'SoundHouse'],
  ['Minimal everyday watch with a soft leather strap', 'Fashion', 3299, 4599, 4.5, 863, 'photo-1523275335684-37898b6baf30', 'The Good Hour'],
  ['Sculpted ceramic table lamp for a warmer home', 'Home', 2199, 2999, 4.6, 421, 'photo-1507473885765-e6ed057f782c', 'Casa and Co'],
  ['Everyday retro sneakers, light on your feet', 'Fashion', 2799, 3999, 4.4, 957, 'photo-1542291026-7eec264c27ff', 'Sunday Supply'],
  ['Pocket instant camera for your best little moments', 'Electronics', 7999, 9999, 4.8, 612, 'photo-1516035069371-29a1b244cc32', 'Frame by Frame'],
  ['Easy-care indoor plant in a handmade ceramic pot', 'Home', 899, 1199, 4.3, 314, 'photo-1485955900006-10f4d324d411', 'Little Leaf Studio'],
  ['Daily glow skincare set with gentle botanical care', 'Beauty', 1599, 2199, 4.6, 709, 'photo-1608248543803-ba4f8c70ae0b', 'Kind Skin'],
  ['Portable Bluetooth speaker with room-filling sound', 'Electronics', 1899, 2499, 4.5, 1102, 'photo-1608043152269-423dbba4e7e1', 'SoundHouse'],
];

async function seedData() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured.');
  await mongoose.connect(process.env.MONGODB_URI);

  const email = 'marketly-demo-seller@example.com';
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: 'Marketly Demo Seller',
      email,
      password: crypto.randomBytes(32).toString('hex'),
      role: 'vendor',
    });
  }
  let vendor = await Vendor.findOne({ user: user._id });
  if (!vendor) {
    vendor = await Vendor.create({
      user: user._id,
      storeName: 'Marketly Demo Finds',
      slug: 'marketly-demo-finds',
      storeDescription: 'Sample products for local development.',
      status: 'approved',
      isVerified: true,
    });
  }

  let inserted = 0;
  for (const [index, [name, category, price, salePrice, rating, reviewCount, photo, brand]] of seedProducts.entries()) {
    const sku = `MKT-DEMO-${String(index + 1).padStart(3, '0')}`;
    const exists = await Product.exists({ sku });
    if (exists) continue;
    await Product.create({
      name,
      slug: `${slugify(name, { lower: true, strict: true })}-demo`,
      description: `${name}. A curated sample product for the local Marketly marketplace demo.`,
      shortDescription: name,
      price,
      salePrice,
      category,
      brand,
      vendor: user._id,
      vendorStore: vendor._id,
      vendorName: vendor.storeName,
      stock: 25,
      sku,
      rating,
      reviewCount,
      isFeatured: index < 4,
      images: [{
        url: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=720&q=85`,
        alt: name,
        isPrimary: true,
      }],
    });
    inserted += 1;
  }
  console.log(`Seed complete: ${inserted} sample product(s) added; existing demo SKUs were left unchanged.`);
}

seedData()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
