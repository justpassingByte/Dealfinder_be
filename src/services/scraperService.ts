/**
 * Scraper service (Node.js + Python).
 * Python owns the browser session and now attempts Shopee API first,
 * then falls back to DOM extraction in the same runtime when needed.
 */

import { spawn } from 'child_process';
import path from 'path';
import { Listing } from '../types/listing';
import { ScrapeTelemetry } from '../types/scraperProfile';
import { searchPipelineService } from './searchPipeline';

const DEFAULT_MAX_ITEMS = 80;
const MAX_ALLOWED_ITEMS = 120;

export type ScraperExecutionChannel = 'api' | 'dom';

export interface ScraperRuntimeResult {
    listings: Listing[];
    channel: ScraperExecutionChannel | null;
    blocked: boolean;
    apiAttempted: boolean;
    apiFailureReason: string | null;
    validEmptyResult: boolean;
    error: string | null;
}

function clampMaxItems(value?: number): number {
    if (!value || Number.isNaN(value)) {
        return DEFAULT_MAX_ITEMS;
    }
    return Math.max(1, Math.min(value, MAX_ALLOWED_ITEMS));
}

function normalizeListings(rawListings: any[]): Listing[] {
    return rawListings.map((item) => ({
        title: typeof item?.title === 'string' ? item.title : 'Unknown Product',
        price: typeof item?.price === 'number' ? item.price : Number(item?.price || 0),
        rating: typeof item?.rating === 'number' ? item.rating : Number(item?.rating || 0),
        sold: typeof item?.sold === 'number' ? item.sold : Number(item?.sold || 0),
        shop: typeof item?.shop === 'string' ? item.shop : 'Shopee',
        url: typeof item?.url === 'string' ? item.url : '',
        image: typeof item?.image === 'string' ? item.image : '',
        marketplace: typeof item?.marketplace === 'string' ? item.marketplace : 'shopee',
    }));
}

export function parseScraperRuntimeOutput(dataString: string): ScraperRuntimeResult {
    const parsed = JSON.parse(dataString);

    if (Array.isArray(parsed)) {
        return {
            listings: normalizeListings(parsed),
            channel: 'dom',
            blocked: false,
            apiAttempted: false,
            apiFailureReason: null,
            validEmptyResult: false,
            error: null,
        };
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Python scraper returned an unsupported payload shape.');
    }

    const payload = parsed as Record<string, unknown>;
    const rawListings = Array.isArray(payload.listings) ? payload.listings : [];
    const channelValue = payload.channel;
    const channel: ScraperExecutionChannel | null = channelValue === 'api' || channelValue === 'dom'
        ? channelValue
        : null;

    return {
        listings: normalizeListings(rawListings),
        channel,
        blocked: Boolean(payload.blocked),
        apiAttempted: Boolean(payload.apiAttempted ?? payload.api_attempted),
        apiFailureReason: typeof payload.apiFailureReason === 'string'
            ? payload.apiFailureReason
            : typeof payload.api_failure_reason === 'string'
                ? payload.api_failure_reason
                : null,
        validEmptyResult: Boolean(payload.validEmptyResult ?? payload.valid_empty_result),
        error: typeof payload.error === 'string' ? payload.error : null,
    };
}

async function runPythonScraper(
    query: string,
    maxItems = DEFAULT_MAX_ITEMS,
    isMaintenance = false,
): Promise<ScraperRuntimeResult> {
    const safeMaxItems = clampMaxItems(maxItems);

    return new Promise((resolve, reject) => {
        const pythonScript = path.join(process.cwd(), 'scripts', 'shopee_scraper.py');
        const pythonProcess = spawn('python', [pythonScript, query, String(safeMaxItems), isMaintenance ? 'maintenance' : 'user']);

        const timeoutId = setTimeout(() => {
            pythonProcess.kill('SIGTERM');
            reject(new Error(`Scraper process timed out for query: "${query}"`));
        }, 180000);

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

            if (!dataString.trim()) {
                if (isBlocked) {
                    reject(new Error('Scraper blocked by Shopee security (CAPTCHA).'));
                    return;
                }

                if (code !== 0) {
                    reject(new Error(`Scraper failed with exit code ${code}`));
                    return;
                }

                resolve({
                    listings: [],
                    channel: null,
                    blocked: false,
                    apiAttempted: false,
                    apiFailureReason: null,
                    validEmptyResult: false,
                    error: null,
                });
                return;
            }

            try {
                const runtime = parseScraperRuntimeOutput(dataString);
                const blocked = isBlocked || runtime.blocked;

                if (blocked) {
                    reject(new Error('Scraper blocked by Shopee security (CAPTCHA).'));
                    return;
                }

                if (runtime.error && runtime.listings.length === 0 && !runtime.validEmptyResult) {
                    reject(new Error(runtime.error));
                    return;
                }

                if (code !== 0 && runtime.listings.length === 0 && !runtime.validEmptyResult) {
                    reject(new Error(runtime.error || runtime.apiFailureReason || `Scraper failed with exit code ${code}`));
                    return;
                }

                console.log(
                    `[Scraper] Parsed ${runtime.listings.length} listings for "${query}" via ${runtime.channel ?? 'unknown'} channel`
                );
                resolve(runtime);
            } catch (err) {
                console.error('[Scraper] JSON parse error from Python output. First 200 chars:', dataString.substring(0, 200));
                reject(err);
            }
        });
    });
}

function postProcessListings(query: string, rawListings: Listing[]): Listing[] {
    if (rawListings.length === 0) {
        return [];
    }

    if (query.toLowerCase().startsWith('http')) {
        return rawListings.filter((listing) => listing.price > 0);
    }

    const filtered = searchPipelineService.process(rawListings, query, 40);
    if (filtered.length > 0) {
        return filtered;
    }

    return rawListings
        .filter((listing) => listing.price > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, 40);
}

export async function scrapeListingsWithTelemetry(
    query: string,
    marketplace?: string,
    maxItems = DEFAULT_MAX_ITEMS,
    isMaintenance = false,
): Promise<ScrapeTelemetry> {
    const startedAt = Date.now();

    if (marketplace && marketplace !== 'shopee') {
        return {
            listings: [],
            latencyMs: 0,
            blocked: false,
            failureReason: null,
            rawListingCount: 0,
            processedListingCount: 0,
            channel: null,
            apiAttempted: false,
            apiFailureReason: null,
            validEmptyResult: false,
        };
    }

    try {
        const runtime = await runPythonScraper(query, maxItems, isMaintenance);
        const listings = postProcessListings(query, runtime.listings);

        return {
            listings,
            latencyMs: Date.now() - startedAt,
            blocked: false,
            failureReason: null,
            rawListingCount: runtime.listings.length,
            processedListingCount: listings.length,
            channel: runtime.channel,
            apiAttempted: runtime.apiAttempted,
            apiFailureReason: runtime.apiFailureReason,
            validEmptyResult: runtime.validEmptyResult && listings.length === 0,
        };
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        const blocked = /captcha|blocked/i.test(message);

        return {
            listings: [],
            latencyMs: Date.now() - startedAt,
            blocked,
            failureReason: message,
            rawListingCount: 0,
            processedListingCount: 0,
            channel: null,
            apiAttempted: false,
            apiFailureReason: null,
            validEmptyResult: false,
        };
    }
}

export async function scrapeListings(
    query: string,
    marketplace?: string,
    maxItems = DEFAULT_MAX_ITEMS,
    isMaintenance = false,
): Promise<Listing[]> {
    const telemetry = await scrapeListingsWithTelemetry(query, marketplace, maxItems, isMaintenance);
    if (telemetry.failureReason) {
        throw new Error(telemetry.failureReason);
    }
    return telemetry.listings;
}
