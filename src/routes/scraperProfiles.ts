import { Request, Response, Router } from 'express';
import { requireAdminSecret } from '../middleware/adminSecret';
import { devtoolsTargetService } from '../services/devtoolsTargetService';
import { scraperProfileService, ScraperProfileError } from '../services/scraperProfileService';
import { StoredScraperProfileStatus } from '../types/scraperProfile';

const router = Router();

router.use(requireAdminSecret);

function getRouteId(req: Request): string {
    return Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
}

function handleRouteError(error: unknown, res: Response): void {
    if (error instanceof ScraperProfileError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
    }

    const message = error instanceof Error ? error.message : 'Internal server error.';
    console.error('[ScraperProfiles] Request failed:', error);
    res.status(500).json({ error: message });
}

router.get('/profiles', async (_req: Request, res: Response) => {
    try {
        const profiles = await scraperProfileService.listProfiles();
        res.json({ profiles });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.get('/profiles/summary', async (_req: Request, res: Response) => {
    try {
        const summary = await scraperProfileService.getSummary();
        res.json(summary);
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.post('/profiles', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.createProfile(req.body);
        res.status(201).json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.patch('/profiles/:id', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.updateProfile(getRouteId(req), req.body);
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.get('/profiles/:id', async (req: Request, res: Response) => {
    try {
        const detail = await scraperProfileService.getProfileDetail(getRouteId(req));
        res.json(detail);
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.get('/profiles/:id/stats', async (req: Request, res: Response) => {
    try {
        const stats = await scraperProfileService.getProfileStats(getRouteId(req));
        res.json(stats);
    } catch (error) {
        handleRouteError(error, res);
    }
});

async function handleDeleteProfile(req: Request, res: Response): Promise<void> {
    try {
        await scraperProfileService.deleteProfile(getRouteId(req));
        res.json({ ok: true });
    } catch (error) {
        handleRouteError(error, res);
    }
}

router.post('/profiles/:id/delete', handleDeleteProfile);
router.post('/profiles/:id/archive', handleDeleteProfile);

router.post('/profiles/:id/recovery/start', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.startRecovery(getRouteId(req));
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.get('/profiles/:id/devtools/targets', async (req: Request, res: Response) => {
    try {
        const detail = await scraperProfileService.getProfileDetail(getRouteId(req));
        const targets = await devtoolsTargetService.listTargets(detail.profile);
        res.json({
            profileId: detail.profile.id,
            debugTunnelPort: detail.profile.debugTunnelPort ?? detail.profile.browserTargetPort,
            targets,
        });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.get('/profiles/:id/devtools/status', async (req: Request, res: Response) => {
    try {
        const detail = await scraperProfileService.getProfileDetail(getRouteId(req));
        const status = await devtoolsTargetService.checkStatus(detail.profile);
        res.json({
            profileId: detail.profile.id,
            status,
        });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.post('/profiles/:id/recovery/finish', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.finishRecovery(getRouteId(req));
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.post('/profiles/:id/warmup/start', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.startWarmup(getRouteId(req), req.body?.warmupQuery);
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.post('/profiles/:id/reset-risk', async (req: Request, res: Response) => {
    try {
        const profile = await scraperProfileService.resetRisk(getRouteId(req));
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

router.post('/profiles/:id/status', async (req: Request, res: Response) => {
    try {
        const status = req.body?.status as StoredScraperProfileStatus | undefined;
        if (!status) {
            throw new ScraperProfileError('status is required.', 400);
        }

        const allowedStatuses: StoredScraperProfileStatus[] = [
            'pending_setup',
            'active',
            'warning',
            'blocked',
            'recovering',
            'warming',
            'cooldown',
            'archived',
        ];

        if (!allowedStatuses.includes(status)) {
            throw new ScraperProfileError(`Unsupported status "${status}".`, 400);
        }

        const profile = await scraperProfileService.overrideStatus(getRouteId(req), status, req.body?.notes);
        res.json({ profile });
    } catch (error) {
        handleRouteError(error, res);
    }
});

export default router;
