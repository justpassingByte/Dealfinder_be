import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as readline from 'readline';
import * as path from 'path';

chromium.use(StealthPlugin());

async function persistentLogin() {
    console.log('--- Shopee Persistent Profile Login ---');
    console.log('This will create a dedicated browser profile for the scraper.');
    console.log('1. Log in ONCE in the window that opens.');
    console.log('2. Once logged in, CLOSE the browser window normally.');
    console.log('3. The scraper will then "own" this profile and search perfectly.');

    const profilePath = path.join(process.cwd(), 'shopee_user_profile');

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto('https://shopee.vn/buyer/login', { waitUntil: 'domcontentloaded' });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise((resolve) => {
        rl.question('\nSuccessfully logged in? Close the browser window and press ENTER here...', (ans) => {
            rl.close();
            resolve(ans);
        });
    });

    await context.close();
    console.log(`\nProfile ${profilePath} is now ready for scraping!`);
    process.exit(0);
}

persistentLogin().catch(console.error);
