import { Router, Request, Response } from 'express';
import { getTopProducts } from '../services/catalogRepository';

const router = Router();

/**
 * GET /api/trends
 * Returns the most searched products from the catalog.
 */
router.get('/trends', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string || '8', 10);
        const products = await getTopProducts(limit);
        
        // Return only the names for the trend tags
        const trends = products.map(p => p.normalized_name);
        
        res.json({ trends });
    } catch (err) {
        console.error('[Trends API] Error:', err);
        res.status(500).json({ error: 'Failed to fetch trends.' });
    }
});

export default router;
