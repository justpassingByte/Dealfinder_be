import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
    onboardCreator,
    findCreatorByUserId,
    getCreatorStats,
    getCreatorClicks,
    getCreatorOrders,
} from '../services/creatorService';

const router = Router();

/**
 * POST /api/creators/onboard
 * Requires auth. Creates a Creator row for the current user.
 */
router.post('/creators/onboard', requireAuth, async (req: Request, res: Response) => {
    try {
        const creator = await onboardCreator(req.user!.userId);
        res.status(201).json({
            id: creator.id,
            referralCode: creator.referral_code,
            referralLink: `${req.protocol}://${req.get('host')}/ref/${creator.referral_code}`,
            commissionBalance: creator.commission_balance,
            createdAt: creator.created_at,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Onboarding failed.';
        res.status(409).json({ error: message });
    }
});

/**
 * GET /api/creators/me
 * Requires auth. Returns the creator profile for the current user.
 */
router.get('/creators/me', requireAuth, async (req: Request, res: Response) => {
    const creator = await findCreatorByUserId(req.user!.userId);
    if (!creator) {
        res.status(404).json({ error: 'Not a creator. Use POST /api/creators/onboard first.' });
        return;
    }

    res.json({
        id: creator.id,
        referralCode: creator.referral_code,
        referralLink: `${req.protocol}://${req.get('host')}/ref/${creator.referral_code}`,
        commissionBalance: creator.commission_balance,
        createdAt: creator.created_at,
    });
});

/**
 * GET /api/creators/dashboard
 * Requires auth. Returns stats + recent clicks + recent orders.
 */
router.get('/creators/dashboard', requireAuth, async (req: Request, res: Response) => {
    const creator = await findCreatorByUserId(req.user!.userId);
    if (!creator) {
        res.status(404).json({ error: 'Not a creator.' });
        return;
    }

    const [stats, clicks, orders] = await Promise.all([
        getCreatorStats(creator.id),
        getCreatorClicks(creator.id),
        getCreatorOrders(creator.id),
    ]);

    res.json({
        creator: {
            id: creator.id,
            referralCode: creator.referral_code,
            commissionBalance: creator.commission_balance,
        },
        stats,
        recentClicks: clicks,
        recentOrders: orders,
    });
});

export default router;
