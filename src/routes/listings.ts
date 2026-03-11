import { Router, Request, Response } from 'express';
import { getPriceHistory, getListingById } from '../services/catalogRepository';

const router = Router();

/**
 * GET /api/listings/:listingId/price-history
 * Returns up to 60 historical price points for a listing (chronological order).
 */
router.get('/listings/:listingId/price-history', async (req: Request, res: Response) => {
    const listingId = req.params.listingId as string;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 60) : 60;

    try {
        // Verify listing exists
        const listing = await getListingById(listingId);
        if (!listing) {
            res.status(404).json({ error: 'Listing not found.' });
            return;
        }

        const history = await getPriceHistory(listingId, limit);

        res.json({
            listingId,
            currentPrice: Number(listing.price),
            shopName: listing.shop_name,
            totalEntries: history.length,
            history: history.map((entry) => ({
                price: Number(entry.price),
                recordedAt: entry.recorded_at,
            })),
        });
    } catch (err) {
        console.error('[PriceHistory] Error:', err);
        res.status(500).json({ error: 'Failed to fetch price history.' });
    }
});

export default router;
