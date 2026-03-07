/**
 * TEST: Shopee CSRF-based API (no Playwright)
 */

async function testCsrfApi(query: string) {
    console.log(`--- Testing Shopee CSRF-based API for "${query}" ---`);

    try {
        // 1. Get initial cookies and CSRF token from the home page
        console.log('Fetching home page for cookies...');
        const homeResp = await fetch('https://shopee.vn/', {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        const setCookie = homeResp.headers.get('set-cookie') || '';
        const cookieJar = setCookie.split(',').map(c => c.split(';')[0]).join('; ');

        // Extract x-csrftoken if possible (usually in cookies)
        const csrfTokenMatch = setCookie.match(/csrftoken=([^;]+)/);
        const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : '';

        console.log(`Initial Cookie: ${cookieJar.substring(0, 50)}...`);
        console.log(`CSRF Token: ${csrfToken}`);

        // 2. Search using the API with the captured cookies and CSRF token
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

        console.log('Calling Search API...');
        const resp = await fetch(url, {
            headers: {
                'accept': '*/*',
                'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
                'cookie': cookieJar,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'x-api-source': 'pc',
                'x-requested-with': 'XMLHttpRequest',
                'x-shopee-language': 'vi',
                'referer': `https://shopee.vn/search?keyword=${encodeURIComponent(query)}`,
                'x-csrftoken': csrfToken
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
        console.error('Error:', (err as Error).message);
    }
}

testCsrfApi('iphone 15');
