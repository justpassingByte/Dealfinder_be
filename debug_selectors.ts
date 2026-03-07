import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function debugScreenshot() {
    const browser = await chromium.launch({ headless: true });
    const sessionPath = path.join(process.cwd(), 'shopee_session.json');

    if (!fs.existsSync(sessionPath)) {
        console.error('No session');
        await browser.close();
        return;
    }

    const context = await browser.newContext({
        storageState: sessionPath,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    await page.goto('https://shopee.vn/search?keyword=iphone%2015', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    await page.screenshot({ path: 'shopee_debug_search.png', fullPage: true });
    console.log('Saved shopee_debug_search.png');

    const htmlSnippet = await page.evaluate(() => {
        // Find elements with data-sqe="item"
        const items = document.querySelectorAll('[data-sqe="item"]');
        if (items.length > 0) {
            return `Found ${items.length} items. First item HTML: ${items[0].outerHTML.substring(0, 1000)}`;
        }

        // Find links on the page to see if we're even in a search page
        const links = document.querySelectorAll('a');
        return `Found no items. Links count: ${links.length}. Body length: ${document.body.innerText.length}`;
    });
    console.log(htmlSnippet);

    await browser.close();
}

debugScreenshot();
