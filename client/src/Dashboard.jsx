import React, { useEffect, useState } from 'react';
import { apiRequest, getAccessToken, getApiBaseUrl } from './api.js';

const currency = (amount = 0) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);

function Dashboard({ user, onClose, onSignOut, onUserUpdate, onCatalogChange, notify }) {
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState(null);
  const [vendorStats, setVendorStats] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [couponForm, setCouponForm] = useState({
    code: '',
    discountType: 'percentage',
    discountValue: '',
    minOrderAmount: '',
    validUntil: '',
  });
  const [storeForm, setStoreForm] = useState({ storeName: '', storeDescription: '' });
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    category: 'Home',
    price: '',
    salePrice: '',
    stock: '',
    brand: '',
    sku: '',
  });
  const [productFile, setProductFile] = useState(null);
  const [editingProduct, setEditingProduct] = useState('');

  async function loadDashboard() {
    setError('');
    try {
      if (user.role === 'admin') {
        const [summary, pending, couponList] = await Promise.all([
          apiRequest('/admin/analytics'),
          apiRequest('/vendors?status=pending&limit=100'),
          apiRequest('/coupons').catch(() => []),
        ]);
        setAnalytics(summary);
        setVendors(pending.vendors || []);
        setCoupons(Array.isArray(couponList) ? couponList : couponList?.coupons || []);
      } else if (user.role === 'vendor') {
        try {
          const profile = await apiRequest('/vendors/profile');
          setVendor(profile.vendor);
          if (profile.vendor.status === 'approved') {
            const [dashboard, listing, vendorOrders] = await Promise.all([
              apiRequest('/vendors/dashboard'),
              apiRequest('/products/vendor/my-products?limit=100'),
              apiRequest('/orders/vendor-orders?limit=50'),
            ]);
            setVendorStats(dashboard.stats);
            setProducts(listing.products || []);
            setOrders(vendorOrders.orders || []);
          }
        } catch (profileError) {
          if (profileError.status !== 404) throw profileError;
          setVendor(null);
        }
      } else {
        const result = await apiRequest('/orders/my-orders?limit=50');
        setOrders(result.orders || []);
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, [user.role]);

  async function applyForStore(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/vendors/register', {
        method: 'POST',
        body: storeForm,
      });
      setVendor(result.vendor);
      onUserUpdate({ ...user, role: 'vendor' });
      setTab('overview');
      notify('Your seller application has been submitted for review.');
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function resetProductForm() {
    setProductForm({
      name: '',
      description: '',
      category: 'Home',
      price: '',
      salePrice: '',
      stock: '',
      brand: '',
      sku: '',
    });
    setProductFile(null);
    setEditingProduct('');
  }

  function editProduct(product) {
    setProductForm({
      name: product.name || '',
      description: product.description || '',
      category: product.category || 'Home',
      price: product.price ?? '',
      salePrice: product.salePrice ?? '',
      stock: product.stock ?? '',
      brand: product.brand || '',
      sku: product.sku || '',
    });
    setEditingProduct(product._id);
    setTab('products');
  }

  async function saveProduct(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let result;
      if (productFile) {
        const formData = new FormData();
        Object.entries(productForm).forEach(([key, value]) => {
          if (value !== '') formData.append(key, value);
        });
        formData.append('images', productFile);
        const response = await fetch(`${getApiBaseUrl()}/products${editingProduct ? `/${editingProduct}` : ''}`, {
          method: editingProduct ? 'PUT' : 'POST',
          headers: { Authorization: `Bearer ${getAccessToken()}` },
          body: formData,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `Product save failed (${response.status}).`);
        }
        result = payload.data;
      } else {
        result = await apiRequest(`/products${editingProduct ? `/${editingProduct}` : ''}`, {
          method: editingProduct ? 'PUT' : 'POST',
          body: {
            ...productForm,
            price: Number(productForm.price),
            salePrice: productForm.salePrice === '' ? null : Number(productForm.salePrice),
            stock: Number(productForm.stock),
          },
        });
      }
      if (result.product) {
        setProducts((current) => editingProduct
          ? current.map((product) => product._id === editingProduct ? result.product : product)
          : [result.product, ...current]);
      }
      resetProductForm();
      notify(editingProduct ? 'Product details updated.' : 'Product added to your store.');
      await onCatalogChange();
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(productId) {
    if (!window.confirm('Remove this product from your store?')) return;
    setBusy(true);
    try {
      await apiRequest(`/products/${productId}`, { method: 'DELETE' });
      setProducts((current) => current.filter((product) => product._id !== productId));
      await onCatalogChange();
      notify('Product removed.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function reviewVendor(vendorId, status) {
    setBusy(true);
    try {
      await apiRequest(`/vendors/${vendorId}/status`, { method: 'PUT', body: { status } });
      setVendors((current) => current.filter((entry) => entry._id !== vendorId));
      notify(`Seller application ${status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCoupon(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        code: couponForm.code.toUpperCase().trim(),
        discountType: couponForm.discountType,
        discountValue: Number(couponForm.discountValue),
        minOrderAmount: Number(couponForm.minOrderAmount) || 0,
      };
      if (couponForm.validUntil) {
        payload.validUntil = new Date(couponForm.validUntil);
      }
      await apiRequest('/coupons', { method: 'POST', body: payload });
      setCouponForm({ code: '', discountType: 'percentage', discountValue: '', minOrderAmount: '', validUntil: '' });
      notify('Coupon created.');
      const list = await apiRequest('/coupons').catch(() => []);
      setCoupons(Array.isArray(list) ? list : list?.coupons || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCoupon(couponId) {
    if (!window.confirm('Delete this coupon code?')) return;
    setBusy(true);
    try {
      await apiRequest(`/coupons/${couponId}`, { method: 'DELETE' });
      setCoupons((current) => current.filter((entry) => entry._id !== couponId));
      notify('Coupon deleted.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function advanceOrder(order, item) {
    const nextStatus = {
      placed: 'confirmed',
      confirmed: 'packed',
      packed: 'shipped',
      shipped: 'delivered',
    }[item.status];
    if (!nextStatus) return;
    setBusy(true);
    try {
      await apiRequest(`/orders/${order._id}/items/${item._id}/status`, {
        method: 'PUT',
        body: { status: nextStatus },
      });
      await loadDashboard();
      notify(`Order item marked ${nextStatus}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(orderId) {
    setBusy(true);
    try {
      await apiRequest(`/orders/${orderId}/cancel`, {
        method: 'PUT',
        body: { reason: 'Cancelled by customer' },
      });
      await loadDashboard();
      notify('Order cancelled.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadInvoice(order) {
    try {
      const response = await fetch(`${getApiBaseUrl()}/orders/${order._id}/invoice`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || `Invoice download failed (${response.status}).`);
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${order.orderNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const tabs = user.role === 'admin'
    ? [['overview', 'Overview'], ['vendors', 'Seller applications'], ['coupons', `Coupons (${coupons.length})`]]
    : user.role === 'vendor'
      ? [['overview', 'Overview'], ['products', 'Products'], ['orders', 'Orders']]
      : [['overview', 'Overview'], ['orders', 'My orders'], ['seller', 'Become a seller']];

  return (
    <div className="overlay dashboard-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dashboard-panel" aria-label="Marketplace account dashboard">
        <header className="dashboard-header">
          <div>
            <span className="eyebrow">{user.role === 'admin' ? 'MARKETPLACE CONTROL ROOM' : user.role === 'vendor' ? 'YOUR LITTLE BUSINESS' : 'YOUR MARKETLY ACCOUNT'}</span>
            <h2>Hello, {user.name?.split(' ')[0] || 'there'}.</h2>
          </div>
          <div className="dashboard-header-actions">
            <button type="button" className="dashboard-signout" onClick={onSignOut}>Sign out</button>
            <button type="button" className="icon-button" aria-label="Close dashboard" onClick={onClose}>×</button>
          </div>
        </header>
        <nav className="dashboard-tabs" aria-label="Account sections">
          {tabs.map(([key, label]) => <button key={key} className={tab === key ? 'dashboard-tab-active' : ''} type="button" onClick={() => setTab(key)}>{label}</button>)}
        </nav>
        <div className="dashboard-content">
          {error && <div className="dashboard-error" role="alert">{error}</div>}
          {user.role === 'admin' && tab === 'overview' && (
            <section>
              <div className="dashboard-title-row"><div><span className="eyebrow">THE LAST 30 DAYS</span><h3>Marketplace at a glance</h3></div><button className="dashboard-refresh" type="button" onClick={loadDashboard}>Refresh</button></div>
              {analytics ? <>
                <div className="metric-grid">
                  <div className="metric-card"><span>Gross sales</span><strong>{currency(analytics.summary.grossSales)}</strong></div>
                  <div className="metric-card"><span>Platform commission</span><strong>{currency(analytics.summary.platformCommission)}</strong></div>
                  <div className="metric-card"><span>Orders</span><strong>{analytics.summary.orders}</strong></div>
                  <div className="metric-card"><span>Customers</span><strong>{analytics.summary.customers}</strong></div>
                  <div className="metric-card"><span>Vendors</span><strong>{analytics.summary.vendors}</strong></div>
                  <div className="metric-card"><span>Active products</span><strong>{analytics.summary.activeProducts}</strong></div>
                </div>
                <div className="dashboard-subsection"><h4>Recent daily sales</h4>{analytics.dailyRevenue?.length ? <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Date</th><th>Orders</th><th>Sales</th></tr></thead><tbody>{analytics.dailyRevenue.slice(-10).reverse().map((day) => <tr key={day._id}><td>{day._id}</td><td>{day.orders}</td><td>{currency(day.revenue)}</td></tr>)}</tbody></table></div> : <p className="dashboard-muted">Sales will appear here after the first order.</p>}</div>
              </> : <p className="dashboard-muted">Loading analytics…</p>}
            </section>
          )}
          {user.role === 'admin' && tab === 'vendors' && (
            <section>
              <div className="dashboard-title-row"><div><span className="eyebrow">SELLER ONBOARDING</span><h3>Applications to review</h3></div><span className="dashboard-muted">{vendors.length} pending</span></div>
              {vendors.length ? <div className="dashboard-list">{vendors.map((entry) => <article className="dashboard-list-card" key={entry._id}><div><strong>{entry.storeName}</strong><p>{entry.storeDescription || 'No store description.'}</p><small>{entry.user?.name} · {entry.user?.email}</small></div><div className="dashboard-card-actions"><button disabled={busy} type="button" onClick={() => reviewVendor(entry._id, 'approved')}>Approve</button><button disabled={busy} type="button" onClick={() => reviewVendor(entry._id, 'rejected')}>Reject</button></div></article>)}</div> : <p className="dashboard-muted">No seller applications are waiting. Nice and quiet.</p>}
            </section>
          )}
          {user.role === 'admin' && tab === 'coupons' && (
            <section>
              <div className="dashboard-title-row"><div><span className="eyebrow">PROMOTIONS</span><h3>Discount coupons</h3></div><span className="dashboard-muted">{coupons.length} active</span></div>
              <form className="dashboard-form" onSubmit={createCoupon}>
                <div className="dashboard-form-row">
                  <label>Coupon code<input required uppercase="true" placeholder="e.g. WELCOME10" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} /></label>
                  <label>Type
                    <select value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value })}>
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed amount (₹)</option>
                    </select>
                  </label>
                  <label>Discount value<input required type="number" min="1" step="1" placeholder={couponForm.discountType === 'percentage' ? '10%' : '₹100'} value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })} /></label>
                </div>
                <div className="dashboard-form-row">
                  <label>Min order amount (₹)<input type="number" min="0" placeholder="0" value={couponForm.minOrderAmount} onChange={(e) => setCouponForm({ ...couponForm, minOrderAmount: e.target.value })} /></label>
                  <label>Valid until<input type="date" value={couponForm.validUntil} onChange={(e) => setCouponForm({ ...couponForm, validUntil: e.target.value })} /></label>
                </div>
                <button className="dashboard-primary" disabled={busy} type="submit">{busy ? 'Creating…' : 'Create coupon'}</button>
              </form>
              <div className="dashboard-subsection">
                <h4>Existing coupons ({coupons.length})</h4>
                {coupons.length ? <div className="dashboard-list">{coupons.map((c) => (
                  <article className="dashboard-list-card" key={c._id}>
                    <div>
                      <strong>{c.code}</strong>
                      <p>{c.discountType === 'percentage' ? `${c.discountValue}% off` : `₹${c.discountValue} off`} {c.minOrderAmount ? `· Min order ₹${c.minOrderAmount}` : ''} {c.usedCount ? `· Used ${c.usedCount} times` : ''}</p>
                      <small>Expires {new Date(c.validUntil).toLocaleDateString('en-IN')}</small>
                    </div>
                    <div className="dashboard-card-actions">
                      <button disabled={busy} type="button" onClick={() => deleteCoupon(c._id)}>Delete</button>
                    </div>
                  </article>
                ))}</div> : <p className="dashboard-muted">No coupons created yet. Add one above to offer discounts to customers.</p>}
              </div>
            </section>
          )}
          {user.role === 'vendor' && tab === 'overview' && (
            <section>
              <div className="dashboard-title-row"><div><span className="eyebrow">YOUR STORE</span><h3>{vendor?.storeName || 'Seller profile'}</h3></div>{vendor && <span className={`vendor-status vendor-status-${vendor.status}`}>{vendor.status}</span>}</div>
              {!vendor ? <p className="dashboard-muted">Complete your seller profile to start your independent store.</p> : vendor.status !== 'approved' ? <p className="dashboard-muted">Your application is {vendor.status}. Product listings are available after admin approval.</p> : <div className="metric-grid">
                <div className="metric-card"><span>Products</span><strong>{vendorStats?.totalProducts ?? vendor.totalProducts}</strong></div>
                <div className="metric-card"><span>Sales</span><strong>{vendorStats?.totalOrders ?? 0}</strong></div>
                <div className="metric-card"><span>Net revenue</span><strong>{currency(vendorStats?.totalRevenue)}</strong></div>
                <div className="metric-card"><span>Pending orders</span><strong>{vendorStats?.pendingOrders ?? 0}</strong></div>
                <div className="metric-card"><span>Low stock items</span><strong>{vendorStats?.lowStockProducts ?? 0}</strong></div>
                <div className="metric-card"><span>Store rating</span><strong>{Number(vendorStats?.rating || vendor.rating || 0).toFixed(1)} / 5</strong></div>
              </div>}
              {vendor?.status === 'approved' && <button className="dashboard-primary" type="button" onClick={() => setTab('products')}>Manage your products →</button>}
            </section>
          )}
          {user.role === 'customer' && (tab === 'overview' || tab === 'seller') && (
            <section>
              <span className="eyebrow">INDEPENDENT SELLERS, ONE HAPPY PLACE</span>
              <h3>{tab === 'seller' ? 'Open your Marketly store.' : 'Have a little business of your own?'}</h3>
              <p className="dashboard-muted">Tell us a little about your store. An administrator will review your application before you can list products.</p>
              <form className="dashboard-form" onSubmit={applyForStore}>
                <label>Store name<input required minLength={2} maxLength={100} value={storeForm.storeName} onChange={(event) => setStoreForm({ ...storeForm, storeName: event.target.value })} /></label>
                <label>A short description<textarea maxLength={1000} rows={3} value={storeForm.storeDescription} onChange={(event) => setStoreForm({ ...storeForm, storeDescription: event.target.value })} /></label>
                <button className="dashboard-primary" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit seller application'}</button>
              </form>
            </section>
          )}
          {user.role === 'vendor' && tab === 'products' && (
            <section>
              {!vendor || vendor.status !== 'approved' ? <p className="dashboard-muted">Your store must be approved before you can manage products.</p> : <>
                <div className="dashboard-title-row"><div><span className="eyebrow">PRODUCT MANAGEMENT</span><h3>{editingProduct ? 'Edit product' : 'Add something lovely'}</h3></div>{editingProduct && <button className="dashboard-refresh" type="button" onClick={resetProductForm}>Cancel edit</button>}</div>
                <form className="dashboard-form product-editor" onSubmit={saveProduct}>
                  <label>Product name<input required minLength={2} maxLength={200} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label>
                  <label>Description<textarea required maxLength={5000} rows={3} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></label>
                  <div className="dashboard-form-row"><label>Category<input required value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} /></label><label>Brand<input value={productForm.brand} onChange={(event) => setProductForm({ ...productForm, brand: event.target.value })} /></label></div>
                  <div className="dashboard-form-row"><label>Price (₹)<input required type="number" min="0.01" step="0.01" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} /></label><label>Sale price (₹)<input type="number" min="0" step="0.01" value={productForm.salePrice} onChange={(event) => setProductForm({ ...productForm, salePrice: event.target.value })} /></label><label>Stock<input required type="number" min="0" step="1" value={productForm.stock} onChange={(event) => setProductForm({ ...productForm, stock: event.target.value })} /></label></div>
                  <label>SKU<input value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></label>
                  <label>Product image (optional)<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setProductFile(event.target.files?.[0] || null)} /></label>
                  <button className="dashboard-primary" disabled={busy} type="submit">{busy ? 'Saving…' : editingProduct ? 'Save product changes' : 'Add product to store'}</button>
                </form>
                <div className="dashboard-subsection"><h4>Your products ({products.length})</h4>{products.length ? <div className="dashboard-list">{products.map((product) => <article className="dashboard-list-card" key={product._id}><div><strong>{product.name}</strong><p>{product.category} · {currency(product.salePrice || product.price)} · {product.stock} in stock</p></div><div className="dashboard-card-actions"><button type="button" onClick={() => editProduct(product)}>Edit</button><button disabled={busy} type="button" onClick={() => deleteProduct(product._id)}>Remove</button></div></article>)}</div> : <p className="dashboard-muted">Your store is ready for its first product.</p>}</div>
              </>}
            </section>
          )}
          {(user.role === 'vendor' && tab === 'orders' || user.role === 'customer' && tab === 'orders') && (
            <section>
              <span className="eyebrow">{user.role === 'vendor' ? 'FULFILLMENT' : 'YOUR MARKETLY PURCHASES'}</span>
              <h3>{user.role === 'vendor' ? 'Orders for your store' : 'Your orders'}</h3>
              {orders.length ? <div className="dashboard-list">{orders.map((order) => {
                const items = user.role === 'vendor' ? order.items.filter((item) => String(item.vendor) === String(user._id)) : order.items;
                return <article className="order-card" key={order._id}><div className="order-card-heading"><strong>{order.orderNumber}</strong><span>{order.orderStatus}</span><b>{currency(order.totalAmount)}</b></div><small>{new Date(order.createdAt).toLocaleDateString('en-IN')} · {order.paymentInfo?.method}</small>{items.map((item) => <div className="order-product-row" key={item._id}><span>{item.name} × {item.quantity}</span><span>{item.status}</span>{user.role === 'vendor' && item.status !== 'delivered' && item.status !== 'cancelled' && <button disabled={busy} type="button" onClick={() => advanceOrder(order, item)}>{({ placed: 'Confirm', confirmed: 'Pack', packed: 'Ship', shipped: 'Deliver' })[item.status] || 'Update'}</button>}</div>)}{user.role === 'customer' && <div className="order-actions"><button type="button" onClick={() => downloadInvoice(order)}>Download invoice</button>{!['shipped', 'delivered', 'cancelled'].includes(order.orderStatus) && <button disabled={busy} type="button" onClick={() => cancelOrder(order._id)}>Cancel order</button>}</div>}</article>;
              })}</div> : <p className="dashboard-muted">No orders to show yet.</p>}
            </section>
          )}
        </div>
        <footer className="dashboard-footer"><span>{user.email}</span><span>Role: {user.role}</span></footer>
      </section>
    </div>
  );
}

export default Dashboard;
