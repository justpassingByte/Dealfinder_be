import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScraperRuntimeOutput } from './scraperService';

test('parseScraperRuntimeOutput supports legacy array payloads', () => {
    const runtime = parseScraperRuntimeOutput(JSON.stringify([
        {
            title: 'iPhone 15',
            price: 25000000,
            rating: 4.9,
            sold: 100,
            shop: 'Shop A',
            url: 'https://shopee.vn/product/1/2',
            image: 'https://cf.shopee.vn/file/x',
        },
    ]));

    assert.equal(runtime.channel, 'dom');
    assert.equal(runtime.apiAttempted, false);
    assert.equal(runtime.validEmptyResult, false);
    assert.equal(runtime.listings.length, 1);
    assert.equal(runtime.listings[0].marketplace, 'shopee');
});

test('parseScraperRuntimeOutput supports structured api payloads', () => {
    const runtime = parseScraperRuntimeOutput(JSON.stringify({
        listings: [
            {
                title: 'iPhone 15 Pro Max',
                price: 28900000,
                rating: 4.8,
                sold: 250,
                shop: '123456',
                url: 'https://shopee.vn/product/123/456',
                image: 'https://cf.shopee.vn/file/y',
                marketplace: 'shopee',
            },
        ],
        channel: 'api',
        apiAttempted: true,
        apiFailureReason: null,
        validEmptyResult: false,
    }));

    assert.equal(runtime.channel, 'api');
    assert.equal(runtime.apiAttempted, true);
    assert.equal(runtime.apiFailureReason, null);
    assert.equal(runtime.error, null);
    assert.equal(runtime.listings.length, 1);
});

test('parseScraperRuntimeOutput preserves valid empty api results', () => {
    const runtime = parseScraperRuntimeOutput(JSON.stringify({
        listings: [],
        channel: 'api',
        apiAttempted: true,
        apiFailureReason: null,
        validEmptyResult: true,
    }));

    assert.equal(runtime.channel, 'api');
    assert.equal(runtime.validEmptyResult, true);
    assert.equal(runtime.listings.length, 0);
});

test('parseScraperRuntimeOutput reads runtime errors from structured payloads', () => {
    const runtime = parseScraperRuntimeOutput(JSON.stringify({
        listings: [],
        channel: null,
        apiAttempted: true,
        apiFailureReason: 'API request failed with status 403',
        validEmptyResult: false,
        error: 'General Scraper Error',
    }));

    assert.equal(runtime.channel, null);
    assert.equal(runtime.apiAttempted, true);
    assert.equal(runtime.apiFailureReason, 'API request failed with status 403');
    assert.equal(runtime.error, 'General Scraper Error');
});
