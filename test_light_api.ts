/**
 * TEST: Shopee "Suggestion" API (often less protected)
 */

async function testSuggestionApi(query: string) {
    console.log(`--- Testing Shopee Suggestion API for "${query}" ---`);

    try {
        const url = `https://shopee.vn/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(query)}&limit=10&newest=0&order=desc&page_type=search`;

        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Shopee-Language': 'vi',
            }
        });

        if (!resp.ok) {
            console.error(`Status: ${resp.status}`);
            return;
        }

        const data: any = await resp.json();
        const items = data?.items ?? [];
        console.log(`Success! Found ${items.length} items via Suggestion API.`);
    } catch (err) {
        console.error('Error:', (err as Error).message);
    }
}

testSuggestionApi('iphone 15');
