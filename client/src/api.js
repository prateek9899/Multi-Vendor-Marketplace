import { imageUrl } from './products.js';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const API_ORIGIN = API_BASE.replace(/\/api$/, '');

export const getAccessToken = () => localStorage.getItem('marketly-token');
export const getSavedUser = () => {
  try {
    return JSON.parse(localStorage.getItem('marketly-user') || 'null');
  } catch {
    return null;
  }
};

export async function apiRequest(path, { method = 'GET', body, token, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const accessToken = token || getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Marketplace API is unavailable. Start the server and check its connection.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

export function toStoreProduct(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const rawImage = images[0]?.url || '';
  const image = rawImage.startsWith('/uploads/')
    ? `${API_ORIGIN}${rawImage}`
    : rawImage || imageUrl('photo-1490312278390-ab64016e0aa9');
  const price = Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price)
    ? Number(product.salePrice)
    : Number(product.price);

  return {
    id: String(product._id || product.id),
    name: product.name,
    description: product.description || product.shortDescription || '',
    category: product.category || 'Other',
    price,
    originalPrice: Number(product.price) || price,
    rating: Number(product.rating) || 0,
    reviews: Number(product.reviewCount) || 0,
    badge: product.isFeatured ? 'Featured' : '',
    seller: product.vendorStore?.storeName || product.vendorName || 'Independent seller',
    color: '#e8e4df',
    image,
    stock: Number(product.stock) || 0,
    slug: product.slug,
  };
}

export async function getProducts({ search, category, sortBy } = {}) {
  const params = new URLSearchParams({ page: '1', limit: '100' });
  if (search) params.set('search', search);
  if (category && category !== 'All finds') params.set('category', category);
  if (sortBy) params.set('sortBy', sortBy);
  const result = await apiRequest(`/products?${params.toString()}`);
  return (result.products || []).map(toStoreProduct);
}

export function toStoreCartItem(item) {
  const product = item.product && typeof item.product === 'object'
    ? toStoreProduct(item.product)
    : null;
  const id = String(product?.id || item.product?._id || item.product || '');
  return {
    id,
    quantity: Number(item.quantity) || 1,
    price: Number(item.price) || product?.price || 0,
    product,
  };
}

export const getApiBaseUrl = () => API_BASE;
