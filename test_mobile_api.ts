/**
 * TEST: Shopee "Secret" Mobile API Bypass
 */

async function testMobileApi(query: string) {
    console.log(`--- Testing Shopee Mobile API for "${query}" ---`);

    try {
        const url = `https://shopee.vn/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(query)}&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;

        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Shopee-Language': 'vi',
                'X-API-Source': 'rn', // "rn" stands for React Native (the app!)
                'Referer': 'https://shopee.vn/',
            }
        });

        if (!resp.ok) {
            console.error(`Status: ${resp.status}`);
            return;
        }

        const data: any = await resp.json();
        const items = data?.items ?? [];
        console.log(`Success! Found ${items.length} items via Mobile API.`);

        if (items.length > 0) {
            items.slice(0, 3).forEach((item: any) => {
                console.log(`- ${item.item_basic.name}`);
            });
        }
    } catch (err) {
        console.error('Error:', (err as Error).message);
    }
}

testMobileApi('iphone 15');
