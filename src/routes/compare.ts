import { Router, Request, Response } from 'express';
import { compareListings } from '../services/compareService';
import { Listing } from '../types/listing';

const router = Router();

const handleCompare = (req: Request, res: Response) => {
    let listings: Listing[] = [];

    // Prioritize body (POST), fallback to query (GET)
    if (req.body && Array.isArray(req.body.listings)) {
        listings = req.body.listings;
    } else if (req.query.listings) {
        try {
            listings = JSON.parse(req.query.listings as string);
        } catch {
            return res.status(400).json({ error: 'Invalid "listings" JSON in query.' });
        }
    }

    if (!Array.isArray(listings) || listings.length === 0) {
        return res.status(400).json({ error: 'Provide a non-empty "listings" array.' });
    }

    const result = compareListings(listings);
    if (!result) {
        return res.status(500).json({ error: 'Comparison failed.' });
    }

    res.json(result);
};

router.get('/compare', handleCompare);
router.post('/compare', handleCompare);

export default router;
