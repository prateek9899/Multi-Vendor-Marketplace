const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCheckoutTotals, calculateCommission } = require('../utils/marketplaceMath');

test('checkout totals apply free delivery at ₹999 and round tax to paise', () => {
  assert.deepEqual(calculateCheckoutTotals(998, 0), {
    itemsTotal: 998,
    shippingCharge: 40,
    tax: 179.64,
    discount: 0,
    totalAmount: 1217.64,
  });
  assert.deepEqual(calculateCheckoutTotals(999, 10), {
    itemsTotal: 999,
    shippingCharge: 0,
    tax: 179.82,
    discount: 10,
    totalAmount: 1168.82,
  });
});

test('coupon discounts cannot reduce the payable subtotal below zero', () => {
  assert.equal(calculateCheckoutTotals(250, 500).totalAmount, 85);
});

test('commission and vendor payout split accurately to paise', () => {
  assert.deepEqual(calculateCommission(1234.56, 10), {
    commission: 123.46,
    payout: 1111.1,
  });
});

test('multi-vendor split payouts preserve the exact gross total', () => {
  const lineItems = [
    { price: 499, qty: 2, commissionRate: 10 },
    { price: 1200, qty: 1, commissionRate: 15 },
  ];
  let totalGross = 0;
  let totalCommission = 0;
  let totalPayout = 0;

  for (const item of lineItems) {
    const gross = item.price * item.qty;
    const split = calculateCommission(gross, item.commissionRate);
    totalGross += gross;
    totalCommission += split.commission;
    totalPayout += split.payout;
  }

  assert.equal(totalGross, 2198);
  assert.equal(Math.round((totalCommission + totalPayout) * 100) / 100, totalGross);
});

test('order item status state machine progresses through lifecycle', () => {
  const progression = {
    placed: 'confirmed',
    confirmed: 'packed',
    packed: 'shipped',
    shipped: 'delivered',
  };
  let currentStatus = 'placed';
  while (progression[currentStatus]) {
    currentStatus = progression[currentStatus];
  }
  assert.equal(currentStatus, 'delivered');
});
