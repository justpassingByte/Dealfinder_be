import { db } from '../src/config/db';
import redis from '../src/config/redis';

async function clearData() {
    console.log('[Clear Data] Starting data reset...');

    try {
        // 1. Clear Redis Cache
        console.log('[Clear Data] Flushing Redis database...');
        await redis.flushdb();
        console.log('[Clear Data] Redis cache cleared.');

        // 2. Clear Postgres Database
        console.log('[Clear Data] Fetching tables to truncate...');
        const result = await db.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
        `);
        
        const tables = result.rows
            .map(row => row.tablename)
            .filter(t => !t.startsWith('pg_')); // Ignore system tables if any slip through

        if (tables.length > 0) {
            console.log(`[Clear Data] Truncating tables: ${tables.join(', ')}`);
            // TRUNCATE CASCADE will remove all rows and respect foreign key constraints
            await db.query(`TRUNCATE TABLE ${tables.join(', ')} CASCADE`);
            console.log('[Clear Data] All Postgres tables truncated successfully.');
        } else {
            console.log('[Clear Data] No tables found in the public schema.');
        }

    } catch (error) {
        console.error('[Clear Data] Error clearing data:', error);
    } finally {
        await db.pool.end();
        await redis.quit();
        console.log('[Clear Data] Database connections closed. Done.');
    }
}

clearData().catch(console.error);
