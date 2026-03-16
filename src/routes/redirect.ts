import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { logClick } from '../services/clickService';
import { logClickEvent, getListingById } from '../services/catalogRepository';
import { findCreatorByCode } from '../services/creatorService';
import { optionalAuth } from '../middleware/authMiddleware';

const router = Router();

/**
 * Helper to wrap a raw product URL with Shopee affiliate tracking.
 */
function buildAffiliateUrl(rawUrl: string, subId?: string | null): string {
    const affiliateId = config.shopee.affiliateId;
    console.log(`[Affiliate] Building link for: ${rawUrl}`);
    console.log(`[Affiliate] Using ID: ${affiliateId}`);
    
    if (!affiliateId) {
        console.warn('[Affiliate] SHOPEE_AFFILIATE_ID is missing in .env!');
        return rawUrl;
    }

    try {
        // Step 1: Base landing page (rawUrl)
        // Step 2: Encode the landing page
        const encodedUrl = encodeURIComponent(rawUrl);

        // Step 3 & 4: Build the final redirection link
        // Format: https://s.shopee.vn/an_redir?origin_link=[ENCODED_URL]&affiliate_id=[ID]&sub_id=[SUB]
        let finalUrl = `https://s.shopee.vn/an_redir?origin_link=${encodedUrl}&affiliate_id=${affiliateId}`;

        if (subId) {
            // Clean up subId to match standard (max 5 values separated by dash, but here we just pass one)
            // Ensure no characters like spaces or special symbols break it
            const cleanSubId = subId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 100);
            finalUrl += `&sub_id=${cleanSubId}`;
        }

        console.log(`[Affiliate] Generated URL: ${finalUrl}`);
        return finalUrl;
    } catch (err) {
        console.error('[Affiliate] Error building Short-link:', err);
        return rawUrl;
    }
}

/**
 * GET /api/redirect
 * Legacy redirect — Logs a click and redirects to the affiliate URL.
 * query params: url (required), ref (optional referral code)
 */
router.get('/redirect', optionalAuth, async (req: Request, res: Response) => {
    const productUrl = req.query.url as string | undefined;

    if (!productUrl) {
        res.status(400).json({ error: 'Missing query parameter "url".' });
        return;
    }

    // Extract tracking info
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';

    // Resolve creator from referral code
    const refCode = (req.query.ref as string) || null;
    let creatorId: string | null = null;
    if (refCode) {
        const creator = await findCreatorByCode(refCode);
        if (creator) {
            creatorId = creator.id;
        }
    }

    // Get userId from JWT if present (via optionalAuth middleware)
    const userId = req.user?.userId ?? null;

    // Log the click asynchronously — don't block the redirect
    logClick({
        userId,
        creatorId,
        productUrl,
        ip,
        userAgent,
    }).catch((err) => {
        console.error('[Redirect] Failed to log click:', err);
    });

    // Build affiliate URL and 302 redirect
    const affiliateUrl = buildAffiliateUrl(productUrl, refCode);
    console.log(`[Redirect] Redirecting to: ${affiliateUrl}`);
    res.redirect(302, affiliateUrl);
});

/**
 * GET /api/redirect/:listingId
 * New listing-based redirect — looks up the listing by UUID,
 * logs to click_events table, and 302 redirects.
 */
router.get('/redirect/:listingId', async (req: Request, res: Response) => {
    const listingId = req.params.listingId as string;

    try {
        const listing = await getListingById(listingId);
        if (!listing) {
            res.status(404).json({ error: 'Listing not found.' });
            return;
        }

        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
        const ua = req.headers['user-agent'] || '';

        // Log click event asynchronously — don't block the redirect
        logClickEvent({ listingId, ip, ua }).catch((err) => {
            console.error('[Redirect] Failed to log click event:', err);
        });

        // 302 redirect to the affiliate URL
        const affiliateUrl = buildAffiliateUrl(listing.product_url, `listing_${listingId}`);
        res.redirect(302, affiliateUrl);
    } catch (err) {
        console.error('[Redirect] Error:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
