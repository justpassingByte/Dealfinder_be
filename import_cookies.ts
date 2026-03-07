import * as fs from 'fs';
import * as path from 'path';

/**
 * Convert raw browser cookies (from extensions like Cookie-Editor) 
 * into Playwright storageState format.
 */

async function importCookies() {
    const rawPath = path.join(process.cwd(), 'raw_cookies.json');
    const sessionPath = path.join(process.cwd(), 'shopee_session.json');

    if (!fs.existsSync(rawPath)) {
        console.error('Error: "raw_cookies.json" not found!');
        console.log('Please create a file named "raw_cookies.json" and paste your exported cookies into it.');
        return;
    }

    try {
        const rawContent = fs.readFileSync(rawPath, 'utf-8');
        const cookies = JSON.parse(rawContent);

        // Map to Playwright format
        const playwrightCookies = cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain || '.shopee.vn',
            path: c.path || '/',
            expires: c.expirationDate || Math.floor(Date.now() / 1000) + (3600 * 24 * 30), // Default 30 days
            httpOnly: c.httpOnly ?? true,
            secure: c.secure ?? true,
            sameSite: 'Lax'
        }));

        const storageState = {
            cookies: playwrightCookies,
            origins: [
                {
                    origin: 'https://shopee.vn',
                    localStorage: []
                }
            ]
        };

        fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

        console.log('\n✅ Success! "shopee_session.json" has been created.');
        console.log('The scraper will now use your REAL browser session to search.');

    } catch (err) {
        console.error('Failed to import cookies:', (err as Error).message);
    }
}

importCookies();
