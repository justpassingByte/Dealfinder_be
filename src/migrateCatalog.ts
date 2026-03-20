/**
 * Migration runner for the Product Catalog schema.
 * Executes SQL files from backend/migrations/sql/ in order.
 * Usage: npx ts-node src/migrateCatalog.ts [--down]
 */
import * as fs from 'fs';
import * as path from 'path';
import { db } from './config/db';

const MIGRATION_DIR = path.join(__dirname, '..', 'migrations', 'sql');

const MIGRATION_FILES = [
    '001_extensions.sql',
    '002_products.sql',
    '003_product_variants.sql',
    '004_listings.sql',
    '005_price_history.sql',
    '006_indexes.sql',
    '007_optimize_listings_index.sql',
    '008_click_tracking.sql',
    '009_hot_deals.sql',
    '010_search_logs.sql',
    '011_scraper_profiles.sql',
];

function extractSection(sql: string, section: 'UP' | 'DOWN'): string {
    const lines = sql.split('\n');
    const collecting: string[] = [];
    let inSection = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === `-- ${section}`) {
            inSection = true;
            continue;
        }
        if (trimmed === '-- UP' || trimmed === '-- DOWN') {
            if (inSection) break; // hit the other section
            continue;
        }
        if (inSection) {
            collecting.push(line);
        }
    }

    return collecting.join('\n').trim();
}

async function runMigrations(direction: 'UP' | 'DOWN') {
    const files = direction === 'UP'
        ? MIGRATION_FILES
        : [...MIGRATION_FILES].reverse();

    console.log(`[Catalog Migration] Running ${direction} migrations...`);

    for (const file of files) {
        const filePath = path.join(MIGRATION_DIR, file);
        if (!fs.existsSync(filePath)) {
            console.warn(`[Catalog Migration] File not found: ${file}, skipping.`);
            continue;
        }

        const sql = fs.readFileSync(filePath, 'utf8');
        const sectionSql = extractSection(sql, direction);

        if (!sectionSql) {
            console.warn(`[Catalog Migration] No ${direction} section in ${file}, skipping.`);
            continue;
        }

        try {
            await db.query(sectionSql);
            console.log(`  ✓ ${file} (${direction})`);
        } catch (err: any) {
            console.error(`  ✗ ${file} (${direction}): ${err.message}`);
            throw err;
        }
    }

    console.log(`[Catalog Migration] ${direction} migrations complete.`);
}

async function main() {
    const direction = process.argv.includes('--down') ? 'DOWN' : 'UP';
    try {
        await runMigrations(direction);
        process.exit(0);
    } catch (err) {
        console.error('[Catalog Migration] Migration failed:', err);
        process.exit(1);
    }
}

main();
