import { Router, Request, Response } from 'express';
import { compareListings } from '../services/compareService';
import { Listing } from '../types/listing';

const router = Router();

router.get('/compare', (req: Request, res: Response) => {
    // Accept listings as a JSON-encoded query param or from a POST body.
    let listings: Listing[] = [];

    if (req.query.listings) {
        try {
            listings = JSON.parse(req.query.listings as string);
        } catch {
            res.status(400).json({ error: 'Invalid "listings" JSON.' });
            return;
        }
    }

    if (!Array.isArray(listings) || listings.length === 0) {
        res.status(400).json({ error: 'Provide a non-empty "listings" array.' });
        return;
    }

    const result = compareListings(listings);
    if (!result) {
        res.status(500).json({ error: 'Comparison failed.' });
        return;
    }

    res.json(result);
});

export default router;
