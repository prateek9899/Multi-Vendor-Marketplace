import React, { useEffect, useMemo, useState } from 'react';
import { categories, imageUrl, products } from './products.js';
import {
  apiRequest,
  getAccessToken,
  getSavedUser,
  toStoreCartItem,
  toStoreProduct,
} from './api.js';
import Dashboard from './Dashboard.jsx';

const validDatabaseId = (value) => /^[a-f\d]{24}$/i.test(String(value || ''));
const resolveImage = (image, width = 620) =>
  /^https?:\/\//i.test(image || '') || image?.startsWith('/')
    ? image
    : imageUrl(image, width);

const money = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

function Icon({ name, size = 20 }) {
  const paths = {
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
    cart: <><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    heart: <path d="M20.5 8.7c0 4.1-8.5 10-8.5 10s-8.5-5.9-8.5-10a4.5 4.5 0 0 1 8.5-2.1 4.5 4.5 0 0 1 8.5 2.1Z" />,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    truck: <><path d="M3 6h12v11H3z" /><path d="M15 10h4l3 3v4h-7z" /><circle cx="7.5" cy="19" r="1.5" /><circle cx="18.5" cy="19" r="1.5" /></>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('marketly-cart') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function readWishlist() {
  try {
    const saved = JSON.parse(localStorage.getItem('marketly-wishlist') || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function Rating({ value, count }) {
  return (
    <div className="rating" aria-label={`${value} out of 5 stars, ${count} reviews`}>
      <span className="rating-stars" aria-hidden="true">★★★★★</span>
      <span className="rating-value">{value}</span>
      <span className="rating-count">({count.toLocaleString('en-IN')})</span>
    </div>
  );
}

function App() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All finds');
  const [sort, setSort] = useState('featured');
  const [cart, setCart] = useState(readCart);
  const [wishlist, setWishlist] = useState(readWishlist);
  const [catalog, setCatalog] = useState(products);
  const [catalogMode, setCatalogMode] = useState('sample');
  const [apiStatus, setApiStatus] = useState('checking');
  const [user, setUser] = useState(getSavedUser);
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState('');
  const [checkoutComplete, setCheckoutComplete] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [checkoutForm, setCheckoutForm] = useState({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
  });
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [priceRange, setPriceRange] = useState('all');
  const [productReviews, setProductReviews] = useState([]);
  const [reviewForm, setReviewForm] = useState({ rating: 5, title: '', comment: '' });
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [modalTab, setModalTab] = useState('details');

  useEffect(() => {
    let active = true;
    apiRequest('/products?limit=100')
      .then((result) => {
        if (!active) return;
        const remoteProducts = (result.products || []).map(toStoreProduct);
        if (remoteProducts.length) {
          setCatalog(remoteProducts);
          setCatalogMode('live');
        } else {
          setCatalogMode('sample');
        }
        setApiStatus('online');
      })
      .catch(() => {
        if (active) setApiStatus('offline');
      });

    if (getAccessToken()) {
      apiRequest('/auth/me')
        .then(async ({ user: profile }) => {
          if (!active) return;
          setUser(profile);
            setWishlist((profile.wishlist || []).map((product) => String(product._id || product)));
            localStorage.setItem('marketly-user', JSON.stringify(profile));
          const savedAddress = profile.addresses?.find((address) => address.isDefault) || profile.addresses?.[0];
          if (savedAddress) setCheckoutForm((current) => ({ ...current, ...savedAddress }));
          const result = await apiRequest('/cart');
          if (active) setCart((result.items || []).map(toStoreCartItem));
        })
        .catch((error) => {
          if (error.status === 401) {
            localStorage.removeItem('marketly-token');
            localStorage.removeItem('marketly-user');
            if (active) setUser(null);
          }
        });
    }

    return () => { active = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem('marketly-cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('marketly-wishlist', JSON.stringify(wishlist));
  }, [wishlist]);

  useEffect(() => {
    if (user) localStorage.setItem('marketly-user', JSON.stringify(user));
    else localStorage.removeItem('marketly-user');
  }, [user]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (apiStatus !== 'online' || catalogMode !== 'live') return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: '1', limit: '100' });
    if (submittedQuery.trim()) params.set('search', submittedQuery.trim());
    if (activeCategory !== 'All finds') params.set('category', activeCategory);
    const sortBy = {
      'price-low': 'price_asc',
      'price-high': 'price_desc',
      rating: 'rating',
      discount: 'newest',
      featured: 'newest',
    }[sort];
    if (sortBy) params.set('sortBy', sortBy);
    apiRequest(`/products?${params.toString()}`, { signal: controller.signal })
      .then((result) => {
        setCatalog((result.products || []).map(toStoreProduct));
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setToast(error.message);
      });
    return () => controller.abort();
  }, [activeCategory, apiStatus, catalogMode, sort, submittedQuery]);

  const shownProducts = useMemo(() => {
    const search = submittedQuery.trim().toLowerCase();
    const filtered = catalog.filter((product) => {
      const matchesCategory = activeCategory === 'All finds' || product.category === activeCategory;
      const matchesSearch = !search || `${product.name} ${product.category} ${product.seller}`.toLowerCase().includes(search);
      const matchesPrice =
        priceRange === 'all' ||
        (priceRange === 'under-1500' && product.price < 1500) ||
        (priceRange === '1500-3500' && product.price >= 1500 && product.price <= 3500) ||
        (priceRange === 'over-3500' && product.price > 3500);
      return matchesCategory && matchesSearch && matchesPrice;
    });

    if (sort === 'price-low') filtered.sort((a, b) => a.price - b.price);
    if (sort === 'price-high') filtered.sort((a, b) => b.price - a.price);
    if (sort === 'rating') filtered.sort((a, b) => b.rating - a.rating);
    if (sort === 'discount') filtered.sort((a, b) => (b.originalPrice - b.price) / b.originalPrice - (a.originalPrice - a.price) / a.originalPrice);
    return filtered;
  }, [activeCategory, catalog, priceRange, sort, submittedQuery]);

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartSubtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const catalogById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);
  const cartProducts = cart.map((item) => ({
    ...item,
    product: item.product || catalogById.get(item.id) || products.find((entry) => entry.id === item.id),
  }));

  function searchProducts(event) {
    event.preventDefault();
    setSubmittedQuery(query);
    document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' });
  }

  function chooseCategory(category) {
    setActiveCategory(category);
    setMobileNavOpen(false);
    document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function addToCart(product, quantity = 1) {
    if (user && validDatabaseId(product.id)) {
      try {
        const result = await apiRequest('/cart/add', {
          method: 'POST',
          body: { productId: product.id, quantity },
        });
        setCart((result.items || []).map(toStoreCartItem));
      } catch (error) {
        setToast(error.message);
        return;
      }
    } else {
      setCart((current) => {
        const existing = current.find((item) => item.id === product.id);
        return existing
          ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + quantity } : item)
          : [...current, { id: product.id, quantity, price: product.price }];
      });
    }
    setCheckoutMode(false);
    setCheckoutComplete(false);
    setToast(`${product.name.split(' ').slice(0, 4).join(' ')} added to your bag`);
  }

  async function updateQuantity(productId, change) {
    const item = cart.find((entry) => entry.id === productId);
    if (user && item && validDatabaseId(productId)) {
      try {
        const result = await apiRequest('/cart/update', {
          method: 'PUT',
          body: { productId, quantity: item.quantity + change },
        });
        setCart((result.items || []).map(toStoreCartItem));
        return;
      } catch (error) {
        if (error.status !== 404) {
          setToast(error.message);
          return;
        }
      }
    }
    setCart((current) =>
      current
        .map((item) => item.id === productId ? { ...item, quantity: item.quantity + change } : item)
        .filter((item) => item.quantity > 0),
    );
  }

  async function toggleWishlist(product) {
    const alreadySaved = wishlist.includes(product.id);
    if (user && validDatabaseId(product.id)) {
      try {
        const result = await apiRequest(`/auth/wishlist/${product.id}`, { method: 'POST' });
        setWishlist((result.wishlist || []).map((id) => String(id)));
        setToast(alreadySaved ? 'Removed from your saved finds' : 'Saved to your wishlist');
        return;
      } catch (error) {
        setToast(error.message);
        return;
      }
    }
    setWishlist((current) => alreadySaved ? current.filter((id) => id !== product.id) : [...current, product.id]);
    setToast(alreadySaved ? 'Removed from your saved finds' : 'Saved to your wishlist');
  }

  useEffect(() => {
    if (!selectedProduct || !validDatabaseId(selectedProduct.id)) {
      setProductReviews([]);
      setReviewError('');
      setModalTab('details');
      return;
    }
    setModalTab('details');
    apiRequest(`/reviews/product/${selectedProduct.id}`)
      .then((data) => setProductReviews(data.reviews || []))
      .catch(() => setProductReviews([]));
  }, [selectedProduct?.id]);

  async function submitReview(e) {
    e.preventDefault();
    if (!user) {
      setToast('Please sign in to write a review.');
      setAuthOpen(true);
      return;
    }
    setReviewSubmitting(true);
    setReviewError('');
    try {
      await apiRequest('/reviews', {
        method: 'POST',
        body: {
          productId: selectedProduct.id,
          rating: Number(reviewForm.rating),
          title: reviewForm.title.trim(),
          comment: reviewForm.comment.trim(),
        },
      });
      setReviewForm({ rating: 5, title: '', comment: '' });
      setToast('Review submitted! Thank you.');
      const data = await apiRequest(`/reviews/product/${selectedProduct.id}`);
      setProductReviews(data.reviews || []);
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function voteHelpful(reviewId) {
    if (!user) {
      setToast('Please sign in to vote.');
      setAuthOpen(true);
      return;
    }
    try {
      const result = await apiRequest(`/reviews/${reviewId}/helpful`, { method: 'POST' });
      setProductReviews((current) =>
        current.map((r) => (r._id === reviewId ? { ...r, helpfulCount: result.helpfulCount } : r))
      );
    } catch (err) {
      setToast(err.message);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError('');
    let result;
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      result = await apiRequest(endpoint, { method: 'POST', body: authForm });
    } catch (error) {
      setAuthError(error.message);
      return;
    }
    localStorage.setItem('marketly-token', result.accessToken);
    setUser(result.user);
    setWishlist((result.user.wishlist || []).map((product) => String(product._id || product)));
    setAuthOpen(false);
    setAuthForm({ name: '', email: '', password: '' });
    const address = result.user.addresses?.find((entry) => entry.isDefault) || result.user.addresses?.[0];
    if (address) setCheckoutForm((current) => ({ ...current, ...address }));
    try {
      const pendingItems = cart.filter((item) => validDatabaseId(item.id));
      for (const item of pendingItems) {
        await apiRequest('/cart/add', {
          method: 'POST',
          body: { productId: item.id, quantity: item.quantity },
        });
      }
      const remoteCart = await apiRequest('/cart');
      setCart((remoteCart.items || []).map(toStoreCartItem));
    } catch (error) {
      setToast(`Signed in, but your bag could not be synced: ${error.message}`);
    }
    if (pendingCheckout) {
      setCartOpen(true);
      setCheckoutMode(true);
      setPendingCheckout(false);
    }
    setToast(`Welcome${result.user.name ? `, ${result.user.name.split(' ')[0]}` : ''}!`);
  }

  async function signOut() {
    try {
      if (getAccessToken()) await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
      setToast(`Signed out locally. ${error.message}`);
    } finally {
      localStorage.removeItem('marketly-token');
      localStorage.removeItem('marketly-user');
      localStorage.removeItem('marketly-cart');
      setUser(null);
      setCart([]);
      setCheckoutMode(false);
      setToast('You are signed out.');
    }
  }

  function beginCheckout() {
    setCheckoutComplete(false);
    setCheckoutMessage('');
    setAppliedCoupon(null);
    setCouponCode('');
    if (catalogMode !== 'live' || cart.some((item) => !validDatabaseId(item.id))) {
      setToast('Connect MongoDB and run `npm run seed` in server to enable checkout for the sample catalog.');
      return;
    }
    if (!user) {
      setPendingCheckout(true);
      setAuthMode('login');
      setAuthError('');
      setAuthOpen(true);
      setCartOpen(false);
      return;
    }
    setCheckoutMode(true);
  }

  async function applyCoupon() {
    try {
      const result = await apiRequest('/coupons/validate', {
        method: 'POST',
        body: { code: couponCode, cartTotal: cartSubtotal },
      });
      setAppliedCoupon(result);
      setToast(`Coupon applied — ${money(result.discount)} off.`);
    } catch (error) {
      setAppliedCoupon(null);
      setToast(error.message);
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (!user || orderLoading) return;
    setOrderLoading(true);
    try {
      const { order, razorpayOrder, razorpayKeyId } = await apiRequest('/orders', {
        method: 'POST',
        body: {
          shippingAddress: checkoutForm,
          paymentMethod,
          couponCode: appliedCoupon?.code || undefined,
        },
      });

      if (paymentMethod === 'cod') {
        setCart([]);
        setCheckoutMessage(`Order ${order.orderNumber} is confirmed. Pay on delivery.`);
        setCheckoutComplete(true);
        setCheckoutMode(false);
        return;
      }

      if (!razorpayKeyId || !razorpayOrder) {
        throw new Error('Razorpay did not return a checkout order. Contact support before retrying.');
      }
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load Razorpay Checkout.'));
          document.body.appendChild(script);
        });
      }
      await new Promise((resolve, reject) => {
        const checkout = new window.Razorpay({
          key: razorpayKeyId,
          order_id: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          name: 'Marketly',
          description: `Order ${order.orderNumber}`,
          prefill: { name: user.name, email: user.email, contact: checkoutForm.phone },
          handler: async (payment) => {
            try {
              const verification = await apiRequest('/orders/verify-payment', {
                method: 'POST',
                body: {
                  orderId: order._id,
                  razorpayOrderId: payment.razorpay_order_id,
                  razorpayPaymentId: payment.razorpay_payment_id,
                  razorpaySignature: payment.razorpay_signature,
                },
              });
              setCart([]);
              setCheckoutMessage(verification.message || `Order ${order.orderNumber} is confirmed.`);
              setCheckoutComplete(true);
              setCheckoutMode(false);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          modal: {
            ondismiss: () => reject(new Error('Payment was not completed. Your pending order remains in your order history.')),
          },
        });
        checkout.open();
      });
    } catch (error) {
      setToast(error.message);
    } finally {
      setOrderLoading(false);
    }
  }

  async function refreshCatalog() {
    try {
      const result = await apiRequest('/products?limit=100');
      const remoteProducts = (result.products || []).map(toStoreProduct);
      setCatalog(remoteProducts.length ? remoteProducts : products);
      setCatalogMode(remoteProducts.length ? 'live' : 'sample');
      setApiStatus('online');
    } catch (error) {
      setApiStatus('offline');
      setToast(error.message);
    }
  }

  function ProductCard({ product, compact = false }) {
    const isSaved = wishlist.includes(product.id);
    const discount = Math.round((1 - product.price / product.originalPrice) * 100);
    return (
      <article className={`product-card${compact ? ' product-card-compact' : ''}`}>
        <button
          className={`wishlist-button${isSaved ? ' is-saved' : ''}`}
          type="button"
          aria-label={isSaved ? 'Remove from wishlist' : 'Add to wishlist'}
          onClick={() => toggleWishlist(product)}
        >
          <Icon name="heart" size={18} />
        </button>
        <button className="product-image-button" type="button" onClick={() => setSelectedProduct(product)} aria-label={`View ${product.name}`}>
          <span className="product-image-wrap" style={{ backgroundColor: product.color }}>
            <img src={resolveImage(product.image, 620)} alt={product.name} loading="lazy" />
            {product.badge && <span className="product-badge">{product.badge}</span>}
          </span>
        </button>
        <div className="product-info">
          <span className="product-category">{product.category} <span>·</span> by {product.seller}</span>
          <button className="product-name" type="button" onClick={() => setSelectedProduct(product)}>{product.name}</button>
          <Rating value={product.rating} count={product.reviews} />
          <div className="product-price-row">
            <span className="product-price">{money(product.price)}</span>
            <span className="product-original-price">{money(product.originalPrice)}</span>
            <span className="discount-label">{discount}% off</span>
          </div>
          <div className="delivery-note"><Icon name="truck" size={15} /> Free delivery</div>
          <button className="add-button" type="button" onClick={() => addToCart(product)}>Add to bag <span>+</span></button>
        </div>
      </article>
    );
  }

  return (
    <div className="app-shell">
      <div className="announcement">
        <span><Icon name="spark" size={14} /> {apiStatus === 'online' && catalogMode === 'live' ? 'Live marketplace · browsing real products' : 'Storefront preview · sample products until backend is ready'}</span>
        <a href="#shop">Explore today’s finds <span aria-hidden="true">→</span></a>
      </div>

      <header className="site-header">
        <div className="header-main">
          <a className="brand" href="#" aria-label="Marketly home">
            <span className="brand-mark">m<span>.</span></span>
            <span className="brand-name">marketly<span>good finds, great prices</span></span>
          </a>
          <button className="location-button" type="button" onClick={() => setToast('Delivering across India — enter your pincode at checkout.')}>
            <Icon name="pin" size={20} />
            <span><small>Delivering to</small><strong>Your doorstep</strong></span>
          </button>
          <form className="search-form" onSubmit={searchProducts} role="search">
            <label className="sr-only" htmlFor="site-search">Search products and stores</label>
            <select aria-label="Search category" value={activeCategory} onChange={(event) => setActiveCategory(event.target.value)}>
              {categories.map((category) => <option key={category.name} value={category.name}>{category.name === 'All finds' ? 'All' : category.name}</option>)}
            </select>
            <input id="site-search" type="search" placeholder="Search products, brands and more" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" aria-label="Search"><Icon name="search" size={21} /></button>
          </form>
          <button
            className="header-action account-action"
            type="button"
            onClick={() => {
              if (user) setDashboardOpen(true);
              else {
                setAuthMode('login');
                setAuthError('');
                setAuthOpen(true);
              }
            }}
          >
            <Icon name="user" size={21} /><span><small>{user ? `Hello, ${user.name.split(' ')[0]}` : 'Hello, there'}</small><strong>{user ? 'Your account' : 'Sign in / Join'}</strong></span>
          </button>
          <button className="header-action saved-action" type="button" onClick={() => { setActiveCategory('All finds'); setSubmittedQuery(''); setToast(`${wishlist.length} saved ${wishlist.length === 1 ? 'find' : 'finds'} in your wishlist`); }}>
            <Icon name="heart" size={21} /><span><small>Your little</small><strong>Wishlist</strong></span>
          </button>
          <button className="header-action cart-action" type="button" onClick={() => { setCheckoutComplete(false); setCartOpen(true); }}>
            <span className="cart-icon-wrap"><Icon name="cart" size={23} /><span className="cart-count">{cartCount}</span></span>
            <strong>Bag</strong>
          </button>
        </div>
        <nav className={`category-nav${mobileNavOpen ? ' nav-open' : ''}`} aria-label="Shop categories">
          <button className="nav-all" type="button" onClick={() => setMobileNavOpen(!mobileNavOpen)}><Icon name="menu" size={18} /> All</button>
          {categories.slice(1).map((category) => (
            <button key={category.name} type="button" className={activeCategory === category.name ? 'nav-active' : ''} onClick={() => chooseCategory(category.name)}>{category.name}</button>
          ))}
          <a href="#story">Our small-business promise</a>
          <a className="nav-right" href="#deals">Good things, better prices <span>↗</span></a>
        </nav>
      </header>

      <main>
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-dot" /> THE MARKETPLACE FOR GOOD FINDS</span>
            <h1 id="hero-title">Find your<br />next <em>favorite</em> thing.</h1>
            <p>Thoughtful picks from independent sellers, all in one happy place. Go on, find something you love.</p>
            <div className="hero-actions">
              <a className="primary-button" href="#shop">Shop the good stuff <Icon name="arrow" size={17} /></a>
              <span className="hero-social-proof"><span>✦</span> 2,400+ happy little finds</span>
            </div>
            <div className="hero-benefits">
              <span><Icon name="check" size={15} /> Small sellers, big heart</span>
              <span><Icon name="check" size={15} /> Free delivery over ₹999</span>
            </div>
          </div>
          <div className="hero-art" aria-label="A curated selection from independent makers">
            <div className="hero-sun" />
            <div className="hero-sticker">MADE WITH<br />A LITTLE<br /><strong>MORE LOVE</strong><span>✳</span></div>
            <div className="hero-image-main">
              <img src={imageUrl('photo-1490312278390-ab64016e0aa9', 1000)} alt="Thoughtfully arranged home and lifestyle objects" />
            </div>
            <div className="hero-image-small">
              <img src={imageUrl('photo-1542291026-7eec264c27ff', 400)} alt="A colorful sneaker from an independent seller" />
            </div>
            <div className="hero-note"><span>✦</span><div><strong>Good things,</strong><small>from good people.</small></div></div>
          </div>
        </section>

        <section className="trust-strip page-width" aria-label="Marketplace benefits">
          <div><span className="trust-icon">✳</span><span><strong>Independent sellers</strong><small>One-of-a-kind finds, always</small></span></div>
          <div><span className="trust-icon">♡</span><span><strong>Picked with care</strong><small>Quality you can feel good about</small></span></div>
          <div><span className="trust-icon">↗</span><span><strong>Easy, happy delivery</strong><small>Free shipping over ₹999</small></span></div>
          <div><span className="trust-icon">☼</span><span><strong>Good returns energy</strong><small>30 days to change your mind</small></span></div>
        </section>

        <section className="category-section page-width">
          <div className="section-heading">
            <div><span className="eyebrow">A LITTLE SOMETHING FOR EVERYONE</span><h2>Browse by <em>mood.</em></h2></div>
            <a href="#shop">All the good stuff <Icon name="arrow" size={16} /></a>
          </div>
          <div className="category-cards">
            {[
              { name: 'Electronics', note: 'The things that just click', photo: 'photo-1498049794561-7780e7231661', tint: '#e4e8e8', symbol: '⌁' },
              { name: 'Home', note: 'Make yourself at home', photo: 'photo-1616486338812-3dadae4b4ace', tint: '#e9e4da', symbol: '⌂' },
              { name: 'Fashion', note: 'A little more you', photo: 'photo-1483985988355-763728e1935b', tint: '#e9e1dc', symbol: '◌' },
              { name: 'Beauty', note: 'Feel-good, look-good', photo: 'photo-1608248543803-ba4f8c70ae0b', tint: '#eee2dd', symbol: '✿' },
            ].map((category) => (
              <button className="category-card" key={category.name} style={{ '--category-tint': category.tint }} type="button" onClick={() => chooseCategory(category.name)}>
                <img src={imageUrl(category.photo, 480)} alt="" loading="lazy" />
                <span className="category-symbol">{category.symbol}</span>
                <span className="category-card-copy"><strong>{category.name}</strong><small>{category.note}</small></span>
                <span className="category-arrow"><Icon name="arrow" size={17} /></span>
              </button>
            ))}
          </div>
        </section>

        <section className="deals-banner page-width" id="deals">
          <div className="deals-copy"><span className="eyebrow">A LITTLE TREAT, JUST BECAUSE</span><h2>Good finds.<br /><em>Even better</em> prices.</h2><p>A few of our current favorites, now a little easier to love.</p><a className="dark-button" href="#shop" onClick={() => setSort('discount')}>See the lovely deals <Icon name="arrow" size={16} /></a></div>
          <div className="deal-photos">
            <img src={imageUrl('photo-1505740420928-5e560c06d30e', 360)} alt="Wireless headphones, now on offer" loading="lazy" />
            <img src={imageUrl('photo-1523275335684-37898b6baf30', 360)} alt="Minimal everyday watch, now on offer" loading="lazy" />
            <span>UP TO<br /><strong>35%</strong><br />OFF ✳</span>
          </div>
        </section>

        <section className="shop-section page-width" id="shop">
          <div className="shop-section-title">
            <div><span className="eyebrow">THE GOOD STUFF, RIGHT THIS WAY</span><h2>{submittedQuery ? <>Results for <em>“{submittedQuery}”</em></> : activeCategory === 'All finds' ? <>Today’s <em>good finds.</em></> : <>{activeCategory}, <em>well found.</em></>}</h2></div>
            <span className="product-total">{shownProducts.length} lovely {shownProducts.length === 1 ? 'find' : 'finds'}</span>
          </div>
          <div className="shop-layout">
            <aside className="filters-panel" aria-label="Product filters">
              <div className="filter-heading"><strong>Find your thing</strong><span>✳</span></div>
              <div className="filter-group">
                <h3>Categories</h3>
                {categories.map((category) => (
                  <button className={`filter-category${activeCategory === category.name ? ' filter-active' : ''}`} key={category.name} type="button" onClick={() => setActiveCategory(category.name)}>
                    <span>{category.name}</span><span className="filter-count">{category.count}</span>
                  </button>
                ))}
              </div>
              <div className="filter-group">
                <h3>Price range</h3>
                {[
                  ['all', 'Any price'],
                  ['under-1500', 'Under ₹1,500'],
                  ['1500-3500', '₹1,500 – ₹3,500'],
                  ['over-3500', 'Over ₹3,500'],
                ].map(([value, label]) => (
                  <label className="radio-label" key={value}><input type="radio" name="price-range" checked={priceRange === value} onChange={() => setPriceRange(value)} /><span className="radio-custom" />{label}</label>
                ))}
              </div>
              <div className="seller-note"><span>♡</span><strong>Shop small.<br />Feel good.</strong><p>Every order supports an independent seller and their big idea.</p><a href="#story">Our promise →</a></div>
            </aside>
            <div className="shop-results">
              <div className="results-toolbar">
                <div className="results-tags"><span>Handpicked, always</span>{activeCategory !== 'All finds' && <button type="button" onClick={() => setActiveCategory('All finds')}>{activeCategory} <Icon name="close" size={13} /></button>}{priceRange !== 'all' && <button type="button" onClick={() => setPriceRange('all')}>Price filter <Icon name="close" size={13} /></button>}</div>
                <label className="sort-label">Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="discount">Biggest deal</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Top rated</option></select></label>
              </div>
              {shownProducts.length ? (
                <div className="product-grid">{shownProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div>
              ) : (
                <div className="empty-results"><span>⌕</span><h3>No finds just yet.</h3><p>Try another search or clear a filter. Your perfect something is out there.</p><button type="button" className="primary-button" onClick={() => { setQuery(''); setSubmittedQuery(''); setActiveCategory('All finds'); setPriceRange('all'); }}>Show me everything <Icon name="arrow" size={16} /></button></div>
              )}
            </div>
          </div>
        </section>

        <section className="seller-story" id="story">
          <div className="seller-story-inner page-width">
            <div className="story-art"><img src={imageUrl('photo-1556761175-b413da4baf72', 800)} alt="Independent makers working together on their ideas" loading="lazy" /><span>GOOD<br />PEOPLE.<br /><em>GOOD</em><br />THINGS.</span></div>
            <div className="story-copy"><span className="eyebrow">A MARKETPLACE WITH A LITTLE MORE HEART</span><h2>Big love for<br /><em>small business.</em></h2><p>Behind every good find is a real person with a real story. We bring thoughtful independent makers and the people who love what they make a little closer together.</p><a href="#shop" className="text-link">Meet your new favorite sellers <Icon name="arrow" size={17} /></a><div className="story-stats"><div><strong>150<span>+</span></strong><small>lovely little businesses</small></div><div><strong>2.4k</strong><small>happy finds and counting</small></div><div><strong>1</strong><small>very good reason to shop small</small></div></div></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-top page-width">
          <a className="brand footer-brand" href="#"><span className="brand-mark">m<span>.</span></span><span className="brand-name">marketly<span>good finds, great prices</span></span></a>
          <div className="footer-message">Good finds, great prices.<br /><em>Always a little more heart.</em></div>
          <a className="back-to-top" href="#">Back to the top ↑</a>
        </div>
        <div className="footer-bottom"><span>© 2026 Marketly Marketplace</span><span>Made with a little love, for the love of good finds. <span className="footer-heart">♥</span></span><span>India · INR ₹</span></div>
      </footer>

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}

      {cartOpen && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
          <aside className="cart-drawer" aria-label="Your shopping bag">
            <div className="drawer-header"><div><span className="eyebrow">THE GOOD STUFF YOU FOUND</span><h2>Your bag <span>({cartCount})</span></h2></div><button type="button" className="icon-button" aria-label="Close bag" onClick={() => setCartOpen(false)}><Icon name="close" size={21} /></button></div>
            {checkoutComplete ? (
              <div className="checkout-success"><span className="success-icon"><Icon name="check" size={27} /></span><h3>Well, this is lovely.</h3><p>{checkoutMessage}</p><button className="primary-button" type="button" onClick={() => { setCheckoutComplete(false); setCheckoutMode(false); setCartOpen(false); }}>Back to finding things <Icon name="arrow" size={16} /></button></div>
            ) : cart.length === 0 ? (
              <div className="cart-empty"><span>♡</span><h3>Your bag’s feeling a little lonely.</h3><p>There are so many good things out there. Let’s find something you love.</p><button className="primary-button" type="button" onClick={() => { setCartOpen(false); document.querySelector('#shop')?.scrollIntoView({ behavior: 'smooth' }); }}>Go find something <Icon name="arrow" size={16} /></button></div>
            ) : (
              <>
                <div className="cart-progress"><span>✳</span>You’ve found {cartCount} lovely {cartCount === 1 ? 'thing' : 'things'}</div>
                {checkoutMode ? (
                  <form className="checkout-form" onSubmit={submitOrder}>
                    <button className="checkout-back" type="button" onClick={() => setCheckoutMode(false)}>← Back to your bag</button>
                    <h3>Where should we send it?</h3>
                    <div className="checkout-fields">
                      <input required autoComplete="name" placeholder="Full name" value={checkoutForm.fullName} onChange={(event) => setCheckoutForm({ ...checkoutForm, fullName: event.target.value })} />
                      <input required autoComplete="tel" inputMode="tel" placeholder="Phone number" value={checkoutForm.phone} onChange={(event) => setCheckoutForm({ ...checkoutForm, phone: event.target.value })} />
                      <input required autoComplete="street-address" placeholder="Address" value={checkoutForm.addressLine1} onChange={(event) => setCheckoutForm({ ...checkoutForm, addressLine1: event.target.value })} />
                      <input placeholder="Apartment, suite, etc. (optional)" value={checkoutForm.addressLine2} onChange={(event) => setCheckoutForm({ ...checkoutForm, addressLine2: event.target.value })} />
                      <div className="checkout-fields-row">
                        <input required autoComplete="address-level2" placeholder="City" value={checkoutForm.city} onChange={(event) => setCheckoutForm({ ...checkoutForm, city: event.target.value })} />
                        <input required autoComplete="address-level1" placeholder="State" value={checkoutForm.state} onChange={(event) => setCheckoutForm({ ...checkoutForm, state: event.target.value })} />
                      </div>
                      <input required autoComplete="postal-code" inputMode="numeric" placeholder="PIN code" value={checkoutForm.pincode} onChange={(event) => setCheckoutForm({ ...checkoutForm, pincode: event.target.value })} />
                    </div>
                    <label className="checkout-payment-label" htmlFor="payment-method">Payment method</label>
                    <select id="payment-method" className="payment-select" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                      <option value="cod">Cash on delivery</option>
                      <option value="razorpay">Razorpay (test mode, if configured)</option>
                    </select>
                    <div className="coupon-entry">
                      <input aria-label="Coupon code" placeholder="Have a coupon?" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
                      <button type="button" onClick={applyCoupon} disabled={!couponCode.trim()}>Apply</button>
                    </div>
                    {appliedCoupon && <p className="coupon-applied">✓ {appliedCoupon.description || appliedCoupon.code}: {money(appliedCoupon.discount)} off</p>}
                    <div className="checkout-total"><span>Subtotal</span><strong>{money(cartSubtotal)}</strong></div>
                    {appliedCoupon && <div className="checkout-total coupon-total"><span>Coupon discount</span><strong>−{money(appliedCoupon.discount)}</strong></div>}
                    <button className="checkout-button" type="submit" disabled={orderLoading}>{orderLoading ? 'Please wait…' : paymentMethod === 'cod' ? 'Place cash-on-delivery order' : 'Continue to secure payment'} <Icon name="arrow" size={17} /></button>
                    <span className="secure-note">Your address is used only to fulfill this order.</span>
                  </form>
                ) : (
                  <>
                    <div className="cart-items">{cartProducts.map(({ product, ...item }) => {
                      if (!product) return null;
                      return <div className="cart-item" key={item.id}><img src={resolveImage(product.image, 180)} alt="" /><div className="cart-item-details"><span>{product.category} · {product.seller}</span><strong>{product.name}</strong><b>{money(item.price * item.quantity)}</b><div className="quantity-control"><button type="button" aria-label="Decrease quantity" onClick={() => updateQuantity(item.id, -1)}>−</button><span>{item.quantity}</span><button type="button" aria-label="Increase quantity" onClick={() => updateQuantity(item.id, 1)}>+</button></div></div><button type="button" className="remove-item" aria-label={`Remove ${product.name}`} onClick={() => updateQuantity(item.id, -item.quantity)}><Icon name="close" size={16} /></button></div>;
                    })}</div>
                    <div className="cart-summary"><div className="shipping-message"><Icon name="truck" size={17} /> {cartSubtotal >= 999 ? 'Your delivery is on us. Lovely.' : `Add ${money(999 - cartSubtotal)} for free delivery.`}</div><div className="subtotal-line"><span>Subtotal</span><strong>{money(cartSubtotal)}</strong></div><p>Delivery and any applicable taxes are calculated at checkout.</p><button className="checkout-button" type="button" onClick={beginCheckout}>Continue to checkout <Icon name="arrow" size={17} /></button><span className="secure-note">{user ? 'Secure checkout · Your order will be saved to your account' : 'Sign in or create an account to place an order'}</span></div>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {selectedProduct && (
        <div className="overlay modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
          <div className="product-modal" role="dialog" aria-modal="true" aria-label={selectedProduct.name}>
            <button className="icon-button modal-close" type="button" aria-label="Close product details" onClick={() => setSelectedProduct(null)}><Icon name="close" size={21} /></button>
            <div className="modal-image" style={{ backgroundColor: selectedProduct.color }}><img src={resolveImage(selectedProduct.image, 800)} alt={selectedProduct.name} /></div>
            <div className="modal-details">
              <div className="modal-tab-header">
                <button type="button" className={`modal-tab-btn ${modalTab === 'details' ? 'active' : ''}`} onClick={() => setModalTab('details')}>Product</button>
                <button type="button" className={`modal-tab-btn ${modalTab === 'reviews' ? 'active' : ''}`} onClick={() => setModalTab('reviews')}>Reviews ({productReviews.length || selectedProduct.reviews || 0})</button>
              </div>

              {modalTab === 'details' ? (
                <>
                  <span className="eyebrow">{selectedProduct.category} · FROM {selectedProduct.seller.toUpperCase()}</span>
                  <h2>{selectedProduct.name}</h2>
                  <button type="button" className="rating-link-btn" onClick={() => setModalTab('reviews')}>
                    <Rating value={selectedProduct.rating} count={selectedProduct.reviews} />
                  </button>
                  <p className="modal-description">{selectedProduct.description}</p>
                  <div className="modal-price">
                    {money(selectedProduct.price)} <span>{money(selectedProduct.originalPrice)}</span> <b>{Math.round((1 - selectedProduct.price / selectedProduct.originalPrice) * 100)}% off</b>
                  </div>
                  <div className="modal-delivery">
                    <Icon name="truck" size={18} />
                    <span><strong>Free delivery</strong><small>On orders over ₹999 · Easy 30-day returns</small></span>
                  </div>
                  <button className="checkout-button" type="button" onClick={() => { addToCart(selectedProduct); setSelectedProduct(null); }}>Add to bag <Icon name="cart" size={18} /></button>
                  <button className={`modal-wishlist${wishlist.includes(selectedProduct.id) ? ' is-saved' : ''}`} type="button" onClick={() => toggleWishlist(selectedProduct)}>
                    <Icon name="heart" size={18} />{wishlist.includes(selectedProduct.id) ? 'Saved to your wishlist' : 'Save for later'}
                  </button>
                </>
              ) : (
                <div className="modal-reviews-pane">
                  <span className="eyebrow">CUSTOMER FEEDBACK</span>
                  <h3>Reviews & Ratings</h3>
                  <div className="review-overall">
                    <Rating value={selectedProduct.rating} count={productReviews.length} />
                  </div>

                  <form className="review-submit-form" onSubmit={submitReview}>
                    <strong>Write a customer review</strong>
                    <div className="review-rating-select">
                      <label htmlFor="review-stars">Rating:</label>
                      <select id="review-stars" value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: e.target.value })}>
                        <option value="5">★★★★★ (5 Stars - Excellent)</option>
                        <option value="4">★★★★☆ (4 Stars - Good)</option>
                        <option value="3">★★★☆☆ (3 Stars - Average)</option>
                        <option value="2">★★☆☆☆ (2 Stars - Below average)</option>
                        <option value="1">★☆☆☆☆ (1 Star - Poor)</option>
                      </select>
                    </div>
                    <input placeholder="Review title (e.g. Great quality and finish)" value={reviewForm.title} onChange={(e) => setReviewForm({ ...reviewForm, title: e.target.value })} />
                    <textarea required rows={2} placeholder="Share your experience with other shoppers…" value={reviewForm.comment} onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })} />
                    {reviewError && <p className="auth-error">{reviewError}</p>}
                    <button className="review-submit-btn" type="submit" disabled={reviewSubmitting}>{reviewSubmitting ? 'Posting…' : 'Submit review'}</button>
                  </form>

                  <div className="reviews-list">
                    {productReviews.length ? (
                      productReviews.map((rev) => (
                        <div key={rev._id} className="review-item">
                          <div className="review-item-header">
                            <strong>{rev.userName || rev.user?.name || 'Customer'}</strong>
                            {rev.isVerifiedPurchase && <span className="verified-badge">✓ Verified purchase</span>}
                          </div>
                          <div className="review-stars-line">
                            {'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}
                            {rev.title && <b className="review-title">{rev.title}</b>}
                          </div>
                          <p className="review-comment">{rev.comment}</p>
                          <div className="review-helpful-row">
                            <button type="button" className="helpful-btn" onClick={() => voteHelpful(rev._id)}>Helpful ({rev.helpfulCount || 0})</button>
                            <small>{new Date(rev.createdAt).toLocaleDateString('en-IN')}</small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="dashboard-muted">No customer reviews yet. Be the first to share your thoughts!</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {authOpen && (
        <div className="overlay modal-overlay auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <form className="auth-modal" onSubmit={submitAuth}>
            <button className="icon-button auth-close" type="button" aria-label="Close sign in" onClick={() => { setAuthOpen(false); setPendingCheckout(false); }}><Icon name="close" size={20} /></button>
            <span className="eyebrow">GOOD FINDS LOOK BETTER TOGETHER</span>
            <h2>{authMode === 'register' ? 'Create your account.' : 'Welcome back.'}</h2>
            <p>{authMode === 'register' ? 'Join Marketly and keep all your favorite little finds in one place.' : 'Sign in to your Marketly account to continue to checkout.'}</p>
            {authMode === 'register' && <input required autoComplete="name" minLength={2} maxLength={50} placeholder="Your name" value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} />}
            <input required autoComplete="email" type="email" placeholder="Email address" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} />
            <input required autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} type="password" minLength={6} placeholder="Password (at least 6 characters)" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} />
            {authError && <p className="auth-error" role="alert">{authError}</p>}
            <button className="checkout-button" type="submit">{authMode === 'register' ? 'Create account' : 'Sign in'} <Icon name="arrow" size={17} /></button>
            <button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }}>{authMode === 'register' ? 'Already have an account? Sign in' : 'New to Marketly? Create an account'}</button>
          </form>
        </div>
      )}
      {dashboardOpen && user && (
        <Dashboard
          user={user}
          onClose={() => setDashboardOpen(false)}
          onSignOut={() => { setDashboardOpen(false); signOut(); }}
          onUserUpdate={setUser}
          onCatalogChange={refreshCatalog}
          notify={setToast}
        />
      )}
    </div>
  );
}

export default App;
