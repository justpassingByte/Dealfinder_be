import * as fs from 'fs';
import * as path from 'path';
import { db } from './config/db';

async function runMigration() {
    const migrationPath = path.join(__dirname, 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('[Migration] Running initial schema migtration...');

    try {
        await db.query(sql);
        console.log('[Migration] Migration successful!');
        process.exit(0);
    } catch (err) {
        console.error('[Migration] Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
