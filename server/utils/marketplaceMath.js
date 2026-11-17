const calculateCheckoutTotals = (itemsTotal, discount = 0) => {
  const shippingCharge = itemsTotal >= 999 ? 0 : 40;
  const tax = Math.round(itemsTotal * 0.18 * 100) / 100;
  const appliedDiscount = Math.min(itemsTotal, Math.max(0, discount));
  const totalAmount = Math.max(
    0,
    Math.round((itemsTotal + shippingCharge + tax - appliedDiscount) * 100) / 100
  );
  return { itemsTotal, shippingCharge, tax, discount: appliedDiscount, totalAmount };
};

const calculateCommission = (grossAmount, commissionRate) => {
  const commission = Math.round(grossAmount * commissionRate) / 100;
  return {
    commission,
    payout: Math.round((grossAmount - commission) * 100) / 100,
  };
};

module.exports = { calculateCheckoutTotals, calculateCommission };
