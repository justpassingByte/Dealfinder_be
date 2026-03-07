import { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthPayload } from '../services/authService';

/**
 * Extend Express Request to carry the authenticated user payload.
 */
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}

/**
 * Middleware that requires a valid JWT in the Authorization header.
 * Sets `req.user` with { userId, email } on success.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header.' });
        return;
    }

    const token = header.slice(7);
    try {
        const payload = verifyToken(token);
        req.user = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

/**
 * Optional auth — sets `req.user` if a valid token is present,
 * but doesn't block the request if missing.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        try {
            const payload = verifyToken(header.slice(7));
            req.user = payload;
        } catch {
            // ignore invalid tokens for optional auth
        }
    }
    next();
}
