import { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';

const ADMIN_SECRET_HEADER = 'x-admin-secret';

export function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
    if (config.scraper.adminPublicMode) {
        next();
        return;
    }

    if (!config.scraper.adminSecret) {
        res.status(503).json({ error: 'Scraper admin routes are disabled until SCRAPER_ADMIN_SECRET is configured.' });
        return;
    }

    const candidate = req.header(ADMIN_SECRET_HEADER);
    if (!candidate || candidate !== config.scraper.adminSecret) {
        res.status(401).json({ error: 'Unauthorized.' });
        return;
    }

    next();
}
