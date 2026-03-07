/**
 * Scraper service — THE HYBRID SOLUTION (Node.js + Python).
 * Node.js handles the core logic, Python handles the Shopee bypass.
 */

import { spawn } from 'child_process';
import path from 'path';
import { Listing } from '../types/listing';

async function runPythonScraper(query: string): Promise<Listing[]> {
    return new Promise((resolve) => {
        const pythonScript = path.join(process.cwd(), 'scripts', 'shopee_scraper.py');
        const pythonProcess = spawn('python', [pythonScript, query]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString();
            console.error(`[Python Worker stderr]: ${data.toString()}`);
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.warn(`[Scraper] Python Worker failed (code ${code}). Is Python installed?`);
                return resolve([]);
            }

            try {
                // If the python script outputs extra text to stdout before JSON, we could have parse errors.
                // It should only ever print JSON to stdout and everything else to stderr.
                const results = JSON.parse(dataString);
                return resolve(results.map((item: any) => ({
                    ...item,
                    marketplace: 'shopee'
                })));
            } catch (err) {
                console.error('[Scraper] JSON Parse Error from Python:', dataString.substring(0, 500));
                resolve([]);
            }
        });
    });
}

export async function scrapeListings(query: string, marketplace?: string): Promise<Listing[]> {
    if (!marketplace || marketplace === 'shopee') {
        return await runPythonScraper(query);
    }
    return [];
}
