import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { importOrdersCsv } from '../services/commissionService';

const router = Router();

/**
 * POST /api/commissions/import-csv
 * Requires auth. Accepts raw CSV text in the body.
 * Body: { csv: "<csv content>" }
 */
router.post('/commissions/import-csv', requireAuth, async (req: Request, res: Response) => {
    const { csv } = req.body as { csv?: string };

    if (!csv || typeof csv !== 'string') {
        res.status(400).json({ error: 'Missing "csv" field with CSV content.' });
        return;
    }

    try {
        const results = await importOrdersCsv(csv);
        res.json({
            imported: results.length,
            results,
        });
    } catch (err: unknown) {
        console.error('[Commissions] CSV import error:', err);
        const message = err instanceof Error ? err.message : 'Import failed.';
        res.status(500).json({ error: message });
    }
});

export default router;
