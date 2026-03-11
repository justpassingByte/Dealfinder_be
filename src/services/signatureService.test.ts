/**
 * Unit tests for SignatureService
 *
 * Run with: npx ts-node --test src/services/signatureService.test.ts
 *   or:     node --test -r ts-node/register src/services/signatureService.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSignatures } from './signatureService';

describe('generateSignatures', () => {

    // ── Product Signature Tests ────────────────────────

    describe('Product Signature (brand + model, no storage/color)', () => {

        it('iPhone 14 Pro Max 256GB → apple_iphone_14_pro_max', () => {
            const result = generateSignatures('iPhone 14 Pro Max 256GB');
            assert.equal(result.productSignature, 'apple_iphone_14_pro_max');
            assert.equal(result.brand, 'apple');
        });

        it('iphone 14 pro max 256gb (lowercase) → apple_iphone_14_pro_max', () => {
            const result = generateSignatures('iphone 14 pro max 256gb');
            assert.equal(result.productSignature, 'apple_iphone_14_pro_max');
        });

        it('Samsung Galaxy S23 Ultra → samsung_galaxy_s23_ultra', () => {
            const result = generateSignatures('Samsung Galaxy S23 Ultra');
            assert.equal(result.productSignature, 'samsung_galaxy_s23_ultra');
            assert.equal(result.brand, 'samsung');
        });

        it('sony wh 1000xm5 → sony_wh_1000xm5', () => {
            const result = generateSignatures('sony wh 1000xm5');
            assert.equal(result.productSignature, 'sony_wh_1000xm5');
            assert.equal(result.brand, 'sony');
        });

        it('Xiaomi Redmi Note 12 Pro → xiaomi_redmi_note_12_pro', () => {
            const result = generateSignatures('Xiaomi Redmi Note 12 Pro');
            assert.equal(result.productSignature, 'xiaomi_redmi_note_12_pro');
            assert.equal(result.brand, 'xiaomi');
        });

        it('Google Pixel 8 Pro → google_pixel_8_pro', () => {
            const result = generateSignatures('Google Pixel 8 Pro');
            assert.equal(result.productSignature, 'google_pixel_8_pro');
            assert.equal(result.brand, 'google');
        });

        it('MacBook Air M2 → apple_macbook_air_m2', () => {
            const result = generateSignatures('MacBook Air M2');
            assert.equal(result.productSignature, 'apple_macbook_air_m2');
            assert.equal(result.brand, 'apple');
        });

        it('should NOT include storage in product signature', () => {
            const r1 = generateSignatures('iPhone 14 Pro Max 128GB');
            const r2 = generateSignatures('iPhone 14 Pro Max 256GB');
            assert.equal(r1.productSignature, r2.productSignature);
        });

        it('should NOT include color in product signature', () => {
            const r1 = generateSignatures('iPhone 14 Pro Max Silver');
            const r2 = generateSignatures('iPhone 14 Pro Max Black');
            assert.equal(r1.productSignature, r2.productSignature);
        });
    });

    // ── Variant Signature Tests ────────────────────────

    describe('Variant Signature (storage + color)', () => {

        it('256GB Silver → 256gb_silver', () => {
            const result = generateSignatures('iPhone 14 Pro Max 256GB Silver');
            assert.equal(result.variantSignature, '256gb_silver');
        });

        it('128GB (no color) → 128gb', () => {
            const result = generateSignatures('iPhone 14 Pro Max 128GB');
            assert.equal(result.variantSignature, '128gb');
        });

        it('No storage or color → default', () => {
            const result = generateSignatures('Sony WH 1000XM5');
            assert.equal(result.variantSignature, 'default');
        });

        it('1TB Gold → 1tb_gold', () => {
            const result = generateSignatures('MacBook Pro 1TB Gold');
            assert.equal(result.variantSignature, '1tb_gold');
        });
    });

    // ── Brand Detection Tests ──────────────────────────

    describe('Brand Detection', () => {

        it('detects apple from "iphone"', () => {
            assert.equal(generateSignatures('iphone 15').brand, 'apple');
        });

        it('detects samsung from "galaxy"', () => {
            assert.equal(generateSignatures('galaxy s24').brand, 'samsung');
        });

        it('detects xiaomi from "redmi"', () => {
            assert.equal(generateSignatures('redmi note 13').brand, 'xiaomi');
        });

        it('detects google from "pixel"', () => {
            assert.equal(generateSignatures('pixel 8a').brand, 'google');
        });

        it('detects asus from "rog"', () => {
            assert.equal(generateSignatures('ROG Strix G16').brand, 'asus');
        });

        it('returns null for unknown brands', () => {
            assert.equal(generateSignatures('Unknown Product XYZ').brand, null);
        });
    });

    // ── Edge Cases ─────────────────────────────────────

    describe('Edge Cases', () => {

        it('strips stop words from signature', () => {
            const result = generateSignatures('New Official iPhone 14 Pro Max 256GB Best Sale');
            assert.equal(result.productSignature, 'apple_iphone_14_pro_max');
        });

        it('handles extra whitespace and special characters', () => {
            const result = generateSignatures('  iPhone   14 Pro Max!!!  256GB  ');
            assert.equal(result.productSignature, 'apple_iphone_14_pro_max');
        });

        it('two different storage variants produce same product signature', () => {
            const a = generateSignatures('Samsung Galaxy S23 Ultra 256GB');
            const b = generateSignatures('Samsung Galaxy S23 Ultra 512GB');
            assert.equal(a.productSignature, b.productSignature);
            assert.notEqual(a.variantSignature, b.variantSignature);
        });
    });
});
