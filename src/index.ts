import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/env';
import { runMaintenanceCycle, flushPopularityCounts } from './services/catalogMaintenance';

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err);
    // Give time to log before exiting
    setTimeout(() => process.exit(1), 100);
});

// Route imports
import healthRoutes from './routes/health';
import analyzeRoutes from './routes/analyze';
import searchRoutes from './routes/search';
import compareRoutes from './routes/compare';
import redirectRoutes from './routes/redirect';
// import authRoutes from './routes/auth'; // Removed auth
// import creatorRoutes from './routes/creators'; // Depends on auth
// import commissionRoutes from './routes/commissions'; // Depends on auth
import aiRoutes from './routes/ai';
import listingsRoutes from './routes/listings';
import dealRoutes from './routes/deal';
import dealsRoutes from './routes/deals';
import trendsRoutes from './routes/trends';
import scraperProfilesRoutes from './routes/scraperProfiles';

const app = express();

// --------------- Middleware ---------------
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Larger limit for CSV imports

// --------------- Routes ---------------
app.use('/api', healthRoutes);
app.use('/api', analyzeRoutes);
app.use('/api', searchRoutes);
app.use('/api', compareRoutes);
app.use('/api', redirectRoutes);
// app.use('/api', authRoutes); // Removed auth
// app.use('/api', creatorRoutes); // Depends on auth
// app.use('/api', commissionRoutes); // Depends on auth
app.use('/api', aiRoutes);
app.use('/api', listingsRoutes);
app.use('/api', dealRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api', trendsRoutes);
app.use('/api/admin/scraper', scraperProfilesRoutes);

// --------------- Error handler ---------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// --------------- Start server ---------------
app.listen(config.port, () => {
    console.log(`[Server] DealFinder API running on http://localhost:${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);

    // ── Background Maintenance Scheduler (BullMQ) ─────
    import('./services/queueService').then(({ setupRepeatableJobs }) => {
        setupRepeatableJobs().then(() => {
            console.log('[Queue] BullMQ background systems ready.');
        }).catch(err => {
            console.error('[Queue] Setup failed:', err);
        });
    }).catch(err => {
        console.error('[Queue] Import failed:', err);
    });

    console.log(`[Server] Startup complete. PID: ${process.pid}`);
});

export default app;
