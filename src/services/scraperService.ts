/**
 * Scraper service (Node.js + Python).
 * Python handles scraping; Node.js applies post-scrape filtering/scoring.
 */

import { spawn } from 'child_process';
import path from 'path';
import { Listing } from '../types/listing';
import { searchPipelineService } from './searchPipeline';

const DEFAULT_MAX_ITEMS = 80;
const MAX_ALLOWED_ITEMS = 120;

function clampMaxItems(value?: number): number {
    if (!value || Number.isNaN(value)) {
        return DEFAULT_MAX_ITEMS;
    }
    return Math.max(1, Math.min(value, MAX_ALLOWED_ITEMS));
}

async function runPythonScraper(query: string, maxItems = DEFAULT_MAX_ITEMS, isMaintenance = false): Promise<Listing[]> {
    const safeMaxItems = clampMaxItems(maxItems);

    return new Promise((resolve, reject) => {
        const pythonScript = path.join(process.cwd(), 'scripts', 'shopee_scraper.py');
        const pythonProcess = spawn('python', [pythonScript, query, String(safeMaxItems), isMaintenance ? "maintenance" : "user"]);

        // Tối ưu: Đặt timeout bảo vệ chống treo (Zombie process ngốn RAM VPS)
        const timeoutId = setTimeout(() => {
            pythonProcess.kill('SIGTERM');
            reject(new Error(`Scraper process timed out for query: "${query}"`));
        }, 180000); // 3 phút

        pythonProcess.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });

        let dataString = '';
        let isBlocked = false;

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            const errOutput = data.toString();
            console.error(`[Python Worker stderr]: ${errOutput}`);
            if (errOutput.includes('CAPTCHA') || errOutput.includes('Blocked')) {
                isBlocked = true;
            }
        });

        pythonProcess.on('close', (code) => {
            clearTimeout(timeoutId);

            if (isBlocked) {
                console.error(`[Scraper] CRITICAL: Scraper was blocked by Shopee security.`);
                reject(new Error('Scraper blocked by Shopee security (CAPTCHA).'));
                return;
            }
 
            if (code !== 0) {
                console.warn(`[Scraper] Python worker failed (code ${code}).`);
                // Check if we have some data anyway, but usually code != 0 means bad
                if (!dataString) {
                    reject(new Error(`Scraper failed with exit code ${code}`));
                    return;
                }
            }
 
            try {
                if (!dataString.trim()) {
                    console.warn(`[Scraper] Python worker returned empty output (query: "${query}").`);
                    resolve([]);
                    return;
                }
                const results = JSON.parse(dataString);
                const listings: Listing[] = Array.isArray(results)
                    ? results.map((item: any) => ({
                        ...item,
                        marketplace: 'shopee',
                    }))
                    : [];
                console.log(`[Scraper] Successfully parsed ${listings.length} listings for "${query}"`);
                resolve(listings);
            } catch (err) {
                console.error('[Scraper] JSON parse error from Python output. First 200 chars:', dataString.substring(0, 200));
                reject(err);
            }
        });
    });
}

export async function scrapeListings(query: string, marketplace?: string, maxItems = DEFAULT_MAX_ITEMS, isMaintenance = false): Promise<Listing[]> {
    if (marketplace && marketplace !== 'shopee') {
        return [];
    }

    const rawListings = await runPythonScraper(query, maxItems, isMaintenance);
    if (rawListings.length === 0) {
        return [];
    }

    // Direct URL scrapes don't need relevance filtering - we already know it's the right product.
    if (query.toLowerCase().startsWith('http')) {
        return rawListings.filter(l => l.price > 0);
    }

    const filtered = searchPipelineService.process(rawListings, query, 40);
    if (filtered.length > 0) {
        return filtered;
    }

    // Fallback: keep a stable subset if strict filtering eliminates all records.
    return rawListings
        .filter((listing) => listing.price > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, 40);
}
