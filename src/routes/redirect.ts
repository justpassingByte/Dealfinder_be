import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { logClick } from '../services/clickService';
import { findCreatorByCode } from '../services/creatorService';
import { optionalAuth } from '../middleware/authMiddleware';

const router = Router();

/**
 * GET /api/redirect
 * Logs a click and redirects to the affiliate URL.
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
    const affiliateUrl = `${config.affiliateBaseUrl}${encodeURIComponent(productUrl)}`;
    res.redirect(302, affiliateUrl);
});

export default router;
