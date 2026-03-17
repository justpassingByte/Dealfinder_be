import { scrapeListings } from './services/scraperService';

async function testBackend() {
    const query = "iphone 16";
    console.log(`[Test] Starting backend test for query: "${query}"...`);
    console.log(`[Test] This might take 30-60 seconds due to stealth delays and fetching up to 80 items.`);

    try {
        const startTime = Date.now();
        const results = await scrapeListings(query, 'shopee', 80);
        const duration = (Date.now() - startTime) / 1000;

        console.log(`\n[Test] Completed in ${duration.toFixed(1)}s`);
        console.log(`[Test] Found ${results.length} filtered results.`);

        if (results.length > 0) {
            console.log("\nTop 10 Results:");
            results.slice(0, 10).forEach((r, i) => {
                console.log(`${i + 1}. ${r.title}`);
                console.log(`   Price: ${r.price.toLocaleString()} VND`);
                console.log(`   Rel Score: ${r.relevanceScore} | Match: ${((r.matchRate || 0) * 100).toFixed(0)}%`);
                console.log(`   Shop: ${r.shop}`);
                console.log(`   URL: ${r.url.substring(0, 50)}...`);
                console.log("");
            });
        } else {
            console.log("[Test] No products found. Check stderr for CAPTCHA or blocking messages.");
        }
    } catch (error) {
        console.error("[Test] Fatal error during test:", error);
    }
}

testBackend();
