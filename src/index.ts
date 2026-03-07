import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/env';

// Route imports
import healthRoutes from './routes/health';
import analyzeRoutes from './routes/analyze';
import searchRoutes from './routes/search';
import compareRoutes from './routes/compare';
import redirectRoutes from './routes/redirect';
import authRoutes from './routes/auth';
import creatorRoutes from './routes/creators';
import commissionRoutes from './routes/commissions';
import aiRoutes from './routes/ai';

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
app.use('/api', authRoutes);
app.use('/api', creatorRoutes);
app.use('/api', commissionRoutes);
app.use('/api', aiRoutes);

// --------------- Error handler ---------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// --------------- Start server ---------------
app.listen(config.port, () => {
    console.log(`[Server] DealFinder API running on http://localhost:${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
});

export default app;
