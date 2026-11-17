const PDFDocument = require('pdfkit');
const Order = require('../models/Order');

exports.downloadInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.customer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot download this invoice.' });
    }

    const filename = `invoice-${order.orderNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    pdf.on('error', (error) => {
      console.error('Invoice PDF generation failed:', error.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not generate invoice.' });
      else res.destroy(error);
    });
    pdf.pipe(res);
    pdf.fontSize(22).fillColor('#172630').text('Marketly', { continued: true });
    pdf.fontSize(10).fillColor('#68736d').text('  |  Marketplace invoice', { align: 'right' });
    pdf.moveDown();
    pdf.fontSize(12).fillColor('#263832').text(`Order ${order.orderNumber}`);
    pdf.fontSize(9).fillColor('#68736d').text(`Placed ${new Date(order.createdAt).toLocaleDateString('en-IN')}`);
    pdf.moveDown();
    pdf.fontSize(11).fillColor('#263832').text('Bill to');
    pdf.fontSize(9).fillColor('#68736d')
      .text(order.shippingAddress.fullName)
      .text(order.shippingAddress.addressLine1)
      .text(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`)
      .text(order.shippingAddress.country || 'India');
    pdf.moveDown();
    pdf.fillColor('#263832').fontSize(10).text('Item', 48, pdf.y, { width: 270, continued: true })
      .text('Qty', { width: 45, continued: true, align: 'right' })
      .text('Unit price', { width: 95, continued: true, align: 'right' })
      .text('Total', { align: 'right' });
    pdf.moveDown(0.5);
    pdf.strokeColor('#e5e3dd').moveTo(48, pdf.y).lineTo(547, pdf.y).stroke();
    pdf.moveDown(0.6);
    order.items.forEach((item) => {
      pdf.fontSize(9).fillColor('#48544e').text(item.name, 48, pdf.y, { width: 270, continued: true })
        .text(String(item.quantity), { width: 45, continued: true, align: 'right' })
        .text(`INR ${item.price.toFixed(2)}`, { width: 95, continued: true, align: 'right' })
        .text(`INR ${(item.price * item.quantity).toFixed(2)}`, { align: 'right' });
      pdf.moveDown(0.5);
    });
    pdf.moveDown();
    const totals = [
      ['Items', order.itemsTotal],
      ['Shipping', order.shippingCharge],
      ['Tax', order.tax],
      ['Discount', -order.discount],
      ['Total', order.totalAmount],
    ];
    totals.forEach(([label, amount]) => {
      pdf.fontSize(label === 'Total' ? 11 : 9).fillColor(label === 'Total' ? '#172630' : '#68736d')
        .text(label, 350, pdf.y, { width: 80, continued: true })
        .text(`INR ${Number(amount).toFixed(2)}`, { width: 117, align: 'right' });
    });
    pdf.moveDown(2);
    pdf.fontSize(8).fillColor('#8a938d').text('Thank you for shopping with independent sellers on Marketly.');
    pdf.end();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
