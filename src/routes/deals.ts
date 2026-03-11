import { Router, Request, Response } from 'express';
import { getHotDeals } from '../services/catalogRepository';
import redis from '../config/redis';

const router = Router();

const HOT_DEALS_CACHE_KEY = 'hot_deals:v1';
const HOT_DEALS_TTL = 300; // 5 minutes

/**
 * GET /api/deals/hot
 * Return the best currently detected deals from the catalog.
 */
router.get('/hot', async (req: Request, res: Response) => {
    try {
        // Check cache first
        const cached = await redis.get(HOT_DEALS_CACHE_KEY);
        if (cached) {
            console.log('[Hot Deals] Cache hit');
            res.json({ deals: JSON.parse(cached) });
            return;
        }

        console.log('[Hot Deals] Cache miss, fetching from DB');
        const deals = await getHotDeals(12);

        // Seed cache
        await redis.set(HOT_DEALS_CACHE_KEY, JSON.stringify(deals), 'EX', HOT_DEALS_TTL);

        res.json({ deals });
    } catch (err) {
        console.error('[Hot Deals] Error:', err);
        res.status(500).json({ error: 'Failed to fetch hot deals.' });
    }
});

export default router;
