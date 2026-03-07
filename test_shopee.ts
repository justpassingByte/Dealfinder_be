import { scrapeListings } from './src/services/scraperService';

async function test() {
    console.log('--- Starting Shopee Scrape Test ---');
    try {
        const query = 'iphone 15';
        console.time('scrape-time');
        const results = await scrapeListings(query);
        console.timeEnd('scrape-time');

        console.log(`\nFound ${results.length} results.`);

        if (results.length > 0) {
            console.log('\nTop 2 Results:');
            console.log(JSON.stringify(results.slice(0, 2), null, 2));
        } else {
            console.log('\nNo results found. This might mean the scraper was blocked or the selectors/interception failed.');
        }
    } catch (err: any) {
        console.error('\nScrape failed with error:', err.message);
    }
    console.log('\n--- Test Finished ---');
    process.exit(0);
}

test();
