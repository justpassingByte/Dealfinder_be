import { getHotDeals } from './services/catalogRepository';
import { db } from './config/db';

async function main() {
    console.log('Fetching Hot Deals...');
    const deals = await getHotDeals(10);
    console.log(`Found ${deals.length} deals.`);
    
    // Check listings directly from the DB to see if `is_deal` is being set correctly
    const { rows } = await db.query('SELECT variant_id, is_deal, price FROM listings');
    console.log("Raw Db Listings:");
    console.log(rows);
    
    await db.pool.end();
}

main().catch(console.error);
