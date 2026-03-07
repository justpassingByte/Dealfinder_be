import { Router, Request, Response } from 'express';
import {
    detectMarketplace,
    extractTitleFromUrl,
    normalizeQuery,
    AnalysisResult,
    Marketplace,
} from '../services/analyzeService';

const router = Router();

router.post('/analyze-product', (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "url" in request body.' });
        return;
    }

    const input = url.trim();

    // 1. Detect if it's a URL or just a keyword
    const detection = detectMarketplace(input);

    if (detection) {
        // It's a recognized marketplace URL
        const rawTitle = extractTitleFromUrl(input);
        const query = normalizeQuery(rawTitle);

        const result: AnalysisResult = {
            title: rawTitle || '(could not extract title from URL)',
            marketplace: detection.marketplace,
            productId: detection.productId,
            query: query || rawTitle,
        };
        res.json(result);
    } else if (input.startsWith('http')) {
        // It's an unrecognized URL
        res.status(422).json({
            error: 'Unsupported marketplace URL. Supported: Shopee, Lazada, TikTok Shop.',
        });
    } else {
        // It appears to be a keyword search
        console.log(`[Analyze] Input treated as keyword search: "${input}"`);
        const query = normalizeQuery(input);
        const result: AnalysisResult = {
            title: input,
            marketplace: 'shopee' as Marketplace, // Default marketplace for general searches
            productId: null,
            query: query || input,
        };
        res.json(result);
    }
});

export default router;
