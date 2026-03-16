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
        const limit = parseInt(req.query.limit as string || '6', 10);
        const cacheKey = `${HOT_DEALS_CACHE_KEY}:${limit}`;

        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            console.log(`[Hot Deals] Cache hit for limit ${limit}`);
            res.json({ deals: JSON.parse(cached) });
            return;
        }

        console.log(`[Hot Deals] Cache miss for limit ${limit}, fetching from DB`);
        const deals = await getHotDeals(limit);

        // Seed cache
        await redis.set(cacheKey, JSON.stringify(deals), 'EX', HOT_DEALS_TTL);

        res.json({ deals });
    } catch (err) {
        console.error('[Hot Deals] Error:', err);
        res.status(500).json({ error: 'Failed to fetch hot deals.' });
    }
});

export default router;
