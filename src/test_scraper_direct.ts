
import { scrapeListings } from './services/scraperService';

async function testScraper() {
    const query = "iphone 15";
    console.log(`Testing scraper for: ${query}`);
    try {
        const results = await scrapeListings(query, 'shopee', 5);
        console.log('Results count:', results.length);
        if (results.length > 0) {
            console.log('First result:', results[0]);
        } else {
            console.log('No results returned from scraper.');
        }
    } catch (err) {
        console.error('Scraper test failed:', err);
    }
    process.exit(0);
}

testScraper();
