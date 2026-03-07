import { Pool, QueryResult } from 'pg';
import { config } from './env';

const pool = new Pool({
    connectionString: config.databaseUrl,
});

pool.on('error', (err: Error) => {
    console.error('[DB] Unexpected error on idle client', err);
    process.exit(-1);
});

export const db = {
    query: (text: string, params?: unknown[]): Promise<QueryResult> =>
        pool.query(text, params),
    pool,
};
