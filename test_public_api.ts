/**
 * TEST: Shopee Public API (no Playwright)
 */

async function testPublicApi(query: string) {
    console.log(`--- Testing Shopee Public API for "${query}" ---`);

    const params = new URLSearchParams({
        keyword: query,
        limit: '20',
        newest: '0',
        order: 'desc',
        page_type: 'search',
        scenario: 'PAGE_GLOBAL_SEARCH',
        version: '2'
    });

    const url = `https://shopee.vn/api/v4/search/search_items?${params.toString()}`;

    try {
        const resp = await fetch(url, {
            headers: {
                'accept': '*/*',
                'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'x-api-source': 'pc',
                'x-requested-with': 'XMLHttpRequest',
                'x-shopee-language': 'vi',
                'referer': `https://shopee.vn/search?keyword=${encodeURIComponent(query)}`
            }
        });

        if (!resp.ok) {
            console.error(`Status: ${resp.status} ${resp.statusText}`);
            const body = await resp.text();
            console.error(`Body: ${body.substring(0, 500)}`);
            return;
        }

        const data: any = await resp.json();
        const items = data?.items ?? [];
        console.log(`Found ${items.length} items.`);

        if (items.length > 0) {
            items.slice(0, 5).forEach((item: any, i: number) => {
                const info = item.item_basic;
                console.log(`${i + 1}. ${info.name} - ${info.price / 100000} VND`);
            });
        }
    } catch (err) {
        console.error('Fetch Error:', (err as Error).message);
    }
}

testPublicApi('iphone 15');
