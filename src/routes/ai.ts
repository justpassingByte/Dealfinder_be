import { Router, Request, Response } from 'express';
import { matchProducts, summarizeReviews, detectDeals } from '../services/aiService';
import { Listing } from '../types/listing';

const router = Router();

/**
 * POST /api/ai/match
 * Body: { query: string, listings: Listing[] }
 * Returns top matching listings by TF-IDF similarity.
 */
router.post('/ai/match', (req: Request, res: Response) => {
    const { query, listings } = req.body as { query?: string; listings?: Listing[] };

    if (!query || !listings || !Array.isArray(listings) || listings.length === 0) {
        res.status(400).json({ error: 'Provide "query" (string) and "listings" (non-empty array).' });
        return;
    }

    const matches = matchProducts(query, listings);
    res.json({ matches });
});

/**
 * POST /api/ai/summarize-reviews
 * Body: { reviews: string[] }
 * Returns an extractive summary with sentiment analysis.
 */
router.post('/ai/summarize-reviews', (req: Request, res: Response) => {
    const { reviews } = req.body as { reviews?: string[] };

    if (!reviews || !Array.isArray(reviews)) {
        res.status(400).json({ error: 'Provide "reviews" as an array of strings.' });
        return;
    }

    const summary = summarizeReviews(reviews);
    res.json(summary);
});

/**
 * POST /api/ai/detect-deals
 * Body: { listings: Listing[], threshold?: number }
 * Returns price anomaly detection with z-score analysis.
 */
router.post('/ai/detect-deals', (req: Request, res: Response) => {
    const { listings, threshold } = req.body as { listings?: Listing[]; threshold?: number };

    if (!listings || !Array.isArray(listings) || listings.length === 0) {
        res.status(400).json({ error: 'Provide "listings" as a non-empty array.' });
        return;
    }

    const result = detectDeals(listings, threshold);
    res.json(result);
});

export default router;
