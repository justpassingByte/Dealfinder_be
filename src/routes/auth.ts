import { Router, Request, Response } from 'express';
import { registerUser, loginUser, findUserById } from '../services/authService';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

/**
 * POST /api/auth/register
 * Body: { email, password, referralCode? }
 */
router.post('/auth/register', async (req: Request, res: Response) => {
    const { email, password, referralCode } = req.body as {
        email?: string;
        password?: string;
        referralCode?: string;
    };

    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
    }

    if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
    }

    try {
        // TODO: If referralCode is provided, resolve it to a creator_id via creators table
        const result = await registerUser(email, password, referralCode || null);
        res.status(201).json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Registration failed.';
        res.status(409).json({ error: message });
    }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/auth/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
    }

    try {
        const result = await loginUser(email, password);
        res.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Login failed.';
        res.status(401).json({ error: message });
    }
});

/**
 * GET /api/auth/me
 * Requires Bearer token. Returns current user info.
 */
router.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
    const user = await findUserById(req.user!.userId);
    if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
    }
    res.json({
        id: user.id,
        email: user.email,
        referrerId: user.referrer_id,
        createdAt: user.created_at,
    });
});

export default router;
