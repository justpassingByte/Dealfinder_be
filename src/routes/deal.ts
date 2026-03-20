import { Router, Request, Response } from 'express';
import { getListingById } from '../services/catalogRepository';
import redis from '../config/redis';

const router = Router();

const DEAL_CARD_TTL = 3600; // 1 hour
const cardCacheKey = (listingId: string) => `deal_card:v1:${listingId}`;

/**
 * Format price for display on deal card (VND).
 */
function formatPriceVND(price: number): string {
    return price.toLocaleString('vi-VN') + 'đ';
}

/**
 * Generate an SVG deal card (1200x630 OG image standard).
 * Uses SVG instead of canvas/playwright for zero-dependency, fast generation.
 */
function generateDealCardSVG(data: {
    title: string;
    shopName: string;
    price: number;
    medianPrice: number;
    discountPercent: number;
    rating: number | null;
    sold: number;
}): string {
    const truncatedTitle = data.title.length > 60
        ? data.title.substring(0, 57) + '...'
        : data.title;

    // Split title into lines for wrapping
    const titleLines: string[] = [];
    const words = truncatedTitle.split(' ');
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + ' ' + word).length > 35) {
            titleLines.push(currentLine.trim());
            currentLine = word;
        } else {
            currentLine += ' ' + word;
        }
    }
    if (currentLine.trim()) titleLines.push(currentLine.trim());

    const ratingStars = data.rating
        ? '★'.repeat(Math.round(data.rating)) + '☆'.repeat(5 - Math.round(data.rating))
        : '—';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f172a"/>
      <stop offset="100%" style="stop-color:#1e293b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#14b8a6"/>
      <stop offset="100%" style="stop-color:#2dd4bf"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Decorative circles -->
  <circle cx="1100" cy="80" r="200" fill="#14b8a6" opacity="0.05"/>
  <circle cx="100" cy="550" r="150" fill="#14b8a6" opacity="0.04"/>

  <!-- Logo -->
  <rect x="60" y="40" width="44" height="44" rx="8" fill="#14b8a6"/>
  <text x="82" y="70" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">DF</text>
  <text x="120" y="68" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="white">SmartDeal</text>

  <!-- Deal badge -->
  <rect x="60" y="120" width="200" height="40" rx="20" fill="url(#accent)"/>
  <text x="160" y="146" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">🔥 DEAL TỐT NHẤT</text>

  <!-- Title -->
  ${titleLines.map((line, i) =>
    `<text x="60" y="${200 + i * 42}" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="white">${escapeXml(line)}</text>`
  ).join('\n  ')}

  <!-- Price section -->
  <text x="60" y="${200 + titleLines.length * 42 + 50}" font-family="Arial, sans-serif" font-size="16" fill="#94a3b8" letter-spacing="3">GIÁ ƯU ĐÃI</text>
  <text x="60" y="${200 + titleLines.length * 42 + 100}" font-family="Arial, sans-serif" font-size="56" font-weight="bold" fill="#2dd4bf">${formatPriceVND(data.price)}</text>

  <!-- Median price (strikethrough) -->
  <text x="60" y="${200 + titleLines.length * 42 + 140}" font-family="Arial, sans-serif" font-size="22" fill="#64748b" text-decoration="line-through">${formatPriceVND(data.medianPrice)}</text>

  <!-- Discount badge -->
  <rect x="300" y="${200 + titleLines.length * 42 + 115}" width="120" height="36" rx="18" fill="#ef4444"/>
  <text x="360" y="${200 + titleLines.length * 42 + 139}" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="white" text-anchor="middle">-${data.discountPercent}%</text>

  <!-- Right side info -->
  <rect x="750" y="120" width="390" height="420" rx="16" fill="#1e293b" filter="url(#shadow)"/>

  <text x="790" y="170" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8" letter-spacing="2">CỬA HÀNG</text>
  <text x="790" y="200" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="white">${escapeXml(data.shopName.substring(0, 25))}</text>

  <line x1="790" y1="225" x2="1100" y2="225" stroke="#334155" stroke-width="1"/>

  <text x="790" y="265" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8" letter-spacing="2">ĐÁNH GIÁ</text>
  <text x="790" y="300" font-family="Arial, sans-serif" font-size="24" fill="#fbbf24">${ratingStars}</text>

  <text x="790" y="350" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8" letter-spacing="2">ĐÃ BÁN</text>
  <text x="790" y="385" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="white">${data.sold.toLocaleString('vi-VN')}</text>

  <text x="790" y="435" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8" letter-spacing="2">GIÁ THỊ TRƯỜNG</text>
  <text x="790" y="470" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="white">${formatPriceVND(data.medianPrice)}</text>

  <text x="790" y="520" font-family="Arial, sans-serif" font-size="14" fill="#14b8a6" letter-spacing="1">Tiết kiệm ${formatPriceVND(data.medianPrice - data.price)}</text>

  <!-- Footer -->
  <rect x="0" y="590" width="1200" height="40" fill="#0c1222"/>
  <text x="600" y="616" font-family="Arial, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">smartdeal.top — Tìm sản phẩm tốt nhất cho bạn</text>
</svg>`;
}

/**
 * Escape XML special characters for safe SVG embedding.
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * GET /api/deal/:listingId/card
 * Generate a deal card image (SVG → PNG-compatible) for sharing.
 * Cached in Redis for 1 hour.
 */
router.get('/deal/:listingId/card', async (req: Request, res: Response) => {
    const listingId = req.params.listingId as string;

    try {
        // Check cache first
        const cached = await redis.get(cardCacheKey(listingId));
        if (cached) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(cached);
            return;
        }

        const listing = await getListingById(listingId);
        if (!listing) {
            res.status(404).json({ error: 'Listing not found.' });
            return;
        }

        // For now, we use the listing's own price fields.
        // In a full implementation, we'd look up variant siblings to calculate median.
        // For the card, we'll accept query params for deal data.
        const medianPrice = parseFloat(req.query.medianPrice as string || '0') || Number(listing.price) * 1.2;
        const discountPercent = parseInt(req.query.discountPercent as string || '0', 10) ||
            Math.round(((medianPrice - Number(listing.price)) / medianPrice) * 100);

        if (discountPercent <= 0) {
            res.status(404).json({ error: 'This listing is not flagged as a deal.' });
            return;
        }

        const svg = generateDealCardSVG({
            title: listing.shop_name ? `${listing.shop_name}` : 'Product',
            shopName: listing.shop_name,
            price: Number(listing.price),
            medianPrice,
            discountPercent,
            rating: listing.rating ? Number(listing.rating) : null,
            sold: Number(listing.sold),
        });

        // Cache the SVG
        await redis.set(cardCacheKey(listingId), svg, 'EX', DEAL_CARD_TTL);

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(svg);
    } catch (err) {
        console.error('[DealCard] Error:', err);
        res.status(500).json({ error: 'Failed to generate deal card.' });
    }
});

/**
 * GET /api/deal/:listingId
 * Public deal page — shareable HTML page with OG meta tags.
 * Used for social sharing on Telegram, Facebook, etc.
 */
router.get('/deal/:listingId', async (req: Request, res: Response) => {
    const listingId = req.params.listingId as string;

    // Don't match the /card sub-route
    if (listingId === 'card') return;

    try {
        const listing = await getListingById(listingId);
        if (!listing) {
            res.status(404).send('<h1>Deal not found</h1>');
            return;
        }

        const price = Number(listing.price);
        const medianPrice = parseFloat(req.query.medianPrice as string || '0') || price * 1.2;
        const discountPercent = parseInt(req.query.discountPercent as string || '0', 10) ||
            Math.round(((medianPrice - price) / medianPrice) * 100);
        const rating = listing.rating ? Number(listing.rating) : 0;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const cardImageUrl = `${baseUrl}/api/deal/${listingId}/card?medianPrice=${medianPrice}&discountPercent=${discountPercent}`;
        const redirectUrl = `/api/redirect/${listingId}`;

        const html = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deal: ${escapeXml(listing.shop_name)} — Giảm ${discountPercent}% | SmartDeal</title>
    <meta name="description" content="Giá chỉ ${formatPriceVND(price)} (giảm ${discountPercent}% so với giá thị trường ${formatPriceVND(medianPrice)}). Mua ngay giá hời!">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="product">
    <meta property="og:title" content="🔥 Deal Hời: Giảm ${discountPercent}% — Chỉ ${formatPriceVND(price)}">
    <meta property="og:description" content="Giá thị trường: ${formatPriceVND(medianPrice)}. Tiết kiệm ${formatPriceVND(medianPrice - price)}. Xem ngay trên SmartDeal!">
    <meta property="og:image" content="${cardImageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="${baseUrl}/api/deal/${listingId}">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="🔥 Deal Hời: Giảm ${discountPercent}%">
    <meta name="twitter:description" content="Chỉ ${formatPriceVND(price)} — tiết kiệm ${formatPriceVND(medianPrice - price)}">
    <meta name="twitter:image" content="${cardImageUrl}">

    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
        .card { background: #1e293b; border-radius: 1.5rem; padding: 3rem; max-width: 600px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .badge { display: inline-flex; align-items: center; gap: 0.5rem; background: linear-gradient(135deg, #14b8a6, #2dd4bf); color: white; padding: 0.5rem 1.25rem; border-radius: 2rem; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 1.5rem; }
        .shop { color: #94a3b8; font-size: 0.875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 0.5rem; }
        .title { font-size: 1.5rem; font-weight: 800; color: white; margin-bottom: 2rem; line-height: 1.3; }
        .price-section { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 0.5rem; }
        .price { font-size: 3rem; font-weight: 900; color: #2dd4bf; }
        .median { font-size: 1.25rem; color: #64748b; text-decoration: line-through; }
        .discount { display: inline-flex; background: #ef4444; color: white; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 800; margin-bottom: 2rem; }
        .stats { display: flex; gap: 2rem; margin-bottom: 2rem; padding: 1.5rem; background: #0f172a; border-radius: 1rem; }
        .stat label { color: #94a3b8; font-size: 0.625rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; }
        .stat .value { font-size: 1.25rem; font-weight: 800; color: white; margin-top: 0.25rem; }
        .stars { color: #fbbf24; }
        .cta { display: block; text-align: center; background: linear-gradient(135deg, #003B73, #004a8f); color: white; padding: 1.25rem 2rem; border-radius: 1rem; font-size: 1rem; font-weight: 800; text-decoration: none; transition: all 0.2s; }
        .cta:hover { box-shadow: 0 10px 25px -10px rgba(0,59,115,0.5); transform: translateY(-2px); }
        .footer { margin-top: 2rem; color: #475569; font-size: 0.75rem; text-align: center; }
        .footer a { color: #14b8a6; text-decoration: none; }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge">🔥 Deal Tốt Nhất</div>
        <div class="shop">CỬA HÀNG</div>
        <div class="title">${escapeXml(listing.shop_name)}</div>
        <div class="price-section">
            <div class="price">${formatPriceVND(price)}</div>
            <div class="median">${formatPriceVND(medianPrice)}</div>
        </div>
        <div class="discount">-${discountPercent}% so với giá thị trường</div>
        <div class="stats">
            <div class="stat">
                <label>Đánh giá</label>
                <div class="value"><span class="stars">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}</span></div>
            </div>
            <div class="stat">
                <label>Đã bán</label>
                <div class="value">${Number(listing.sold).toLocaleString('vi-VN')}</div>
            </div>
            <div class="stat">
                <label>Tiết kiệm</label>
                <div class="value" style="color: #2dd4bf;">${formatPriceVND(medianPrice - price)}</div>
            </div>
        </div>
        <a href="${redirectUrl}" class="cta" target="_blank">🛒 Mua Ngay Giá Hời</a>
    </div>
    <div class="footer">Powered by <a href="${baseUrl}">SmartDeal</a> — Tìm sản phẩm tốt nhất cho bạn</div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        console.error('[DealPage] Error:', err);
        res.status(500).send('<h1>Internal server error</h1>');
    }
});

export default router;
