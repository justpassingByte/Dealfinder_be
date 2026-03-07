import test from 'node:test';
import assert from 'node:assert/strict';
import { Listing } from '../types/listing';
import { SearchPipelineService } from './searchPipeline';

function makeListing(overrides: Partial<Listing>): Listing {
    return {
        title: 'default listing',
        price: 1000000,
        rating: 4.8,
        sold: 100,
        shop: 'shop',
        url: 'https://shopee.vn/item',
        image: '',
        marketplace: 'shopee',
        ...overrides,
    };
}

test('SearchPipelineService removes accessories and keeps relevant products', () => {
    const pipeline = new SearchPipelineService();
    const listings: Listing[] = [
        makeListing({ title: 'iPhone 15 Pro Max 256GB Like New', price: 25000000 }),
        makeListing({ title: 'iPhone 15 Case Anti Shock', price: 120000 }),
        makeListing({ title: 'Cáp sạc USB-C cho iPhone 15', price: 150000 }),
    ];

    const results = pipeline.process(listings, 'iPhone 15 Pro Max');

    assert.equal(results.length, 1);
    assert.match(results[0].title.toLowerCase(), /iphone 15 pro max/);
});

test('SearchPipelineService applies price outlier filtering (10% - 500% of median)', () => {
    const pipeline = new SearchPipelineService();
    // Median of [2.4, 2.5, 2.6] is 2.5
    // 10% of 2.5 is 0.25
    // 500% of 2.5 is 12.5
    const listings: Listing[] = [
        makeListing({ title: 'iPhone 15 Pro Max 256GB', price: 26000000 }),
        makeListing({ title: 'iPhone 15 Pro Max 256GB', price: 25000000 }),
        makeListing({ title: 'iPhone 15 Pro Max 256GB', price: 24000000 }),
        makeListing({ title: 'iPhone 15 Pro Max Sticker', price: 50000 }), // ~0.2% of median - should be filtered
    ];

    const results = pipeline.process(listings, 'iPhone 15 Pro Max');

    // "iPhone 15 Pro Max Sticker" matches 4/5 tokens (0.8) which is >= 0.5
    // BUT its price (50k) is below 10% of median (2.5M)
    assert.equal(results.length, 3);
    assert.ok(results.every(item => item.price >= 24000000));
});

test('SearchPipelineService clusters similar titles and picks the largest group', () => {
    const pipeline = new SearchPipelineService();
    const listings: Listing[] = [
        // Group 1: 3 items
        makeListing({ title: 'Samsung Galaxy S24 Ultra 256GB', price: 25000000 }),
        makeListing({ title: 'Samsung S24 Ultra 256GB New', price: 26000000 }),
        makeListing({ title: 'Galaxy S24 Ultra 256 GB', price: 24500000 }),
        // Group 2: 2 items (irrelevant but pass token match if query is broad)
        makeListing({ title: 'Oppo Reno 10 Pro 256GB', price: 15000000 }),
        makeListing({ title: 'Oppo Reno 10 Pro 5G', price: 15500000 }),
    ];

    // If query is "256GB", both groups match token threshold (1/1 token = 1.0)
    // S24 group is larger (3 vs 2)
    const results = pipeline.process(listings, 'S24 Ultra 256GB');

    assert.ok(results.every(item => item.title.toLowerCase().includes('s24')));
});

test('SearchPipelineService returns max 10 results sorted by price', () => {
    const pipeline = new SearchPipelineService();
    const listings: Listing[] = [];

    for (let i = 0; i < 15; i += 1) {
        listings.push(
            makeListing({
                title: `Product Token Match ${i}`,
                price: 15000000 - i * 100000, // Descending price
                url: `https://shopee.vn/item-${i}`,
            })
        );
    }

    const processed = pipeline.process(listings, 'Product Token Match');

    assert.ok(processed.length <= 10);
    // Should be sorted ascending by price
    for (let i = 1; i < processed.length; i += 1) {
        assert.ok(processed[i - 1].price <= processed[i].price);
    }
});

test('SearchPipelineService query-aware accessory filter', () => {
    const pipeline = new SearchPipelineService();
    const listings: Listing[] = [
        makeListing({ title: 'Dây đeo đồng hồ Apple Watch', price: 200000 }),
        makeListing({ title: 'Ốp lưng iPhone 15', price: 50000 }),
    ];

    // Searching specifically for "Dây đeo"
    const results = pipeline.process(listings, 'Dây đeo Apple Watch');

    // Should NOT filter "Dây đeo" since it's in the query
    assert.ok(results.some(r => r.title.includes('Dây đeo')));
    // Should STILL filter "Ốp lưng" as it's an accessory keyword NOT in query
    assert.ok(!results.some(r => r.title.includes('Ốp lưng')));
});
