import { db } from '../config/db';
import { parse } from 'csv-parse/sync';

/**
 * Commission processing service.
 *
 * Handles CSV import and last-click attribution with 50/50 commission split.
 */

export interface CsvOrderRow {
    affiliate_order_id: string;
    commission_amount: string | number;
    timestamp: string;
}

export interface AttributionResult {
    orderId: string;
    affiliateOrderId: string;
    creatorId: string | null;
    creatorCommission: number;
    platformCommission: number;
}

const ATTRIBUTION_WINDOW_HOURS = 24;

/**
 * Import orders from a CSV string and perform last-click attribution.
 *
 * CSV columns expected: affiliate_order_id, commission_amount, timestamp
 *
 * Attribution logic:
 *   - For each order, find the most recent click within the 24h window preceding the order timestamp.
 *   - If found and the click has a creator_id, apply 50/50 split.
 *   - Otherwise, platform keeps 100%.
 */
export async function importOrdersCsv(csvContent: string): Promise<AttributionResult[]> {
    const records: CsvOrderRow[] = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    });

    const results: AttributionResult[] = [];

    for (const record of records) {
        const affiliateOrderId = record.affiliate_order_id;
        const commissionAmount = parseFloat(String(record.commission_amount));
        const orderTimestamp = new Date(record.timestamp);

        if (!affiliateOrderId || isNaN(commissionAmount) || isNaN(orderTimestamp.getTime())) {
            console.warn(`[Commission] Skipping invalid row: ${JSON.stringify(record)}`);
            continue;
        }

        // Check for duplicate
        const existingOrder = await db.query(
            'SELECT id FROM orders WHERE affiliate_order_id = $1',
            [affiliateOrderId]
        );
        if (existingOrder.rows.length > 0) {
            console.warn(`[Commission] Duplicate order skipped: ${affiliateOrderId}`);
            continue;
        }

        // Last-click attribution: find the most recent click within the 24h window
        const windowStart = new Date(orderTimestamp.getTime() - ATTRIBUTION_WINDOW_HOURS * 60 * 60 * 1000);
        const clickResult = await db.query(
            `SELECT id, creator_id, user_id FROM clicks
             WHERE timestamp >= $1 AND timestamp <= $2
             ORDER BY timestamp DESC
             LIMIT 1`,
            [windowStart, orderTimestamp]
        );

        const click = clickResult.rows[0];
        const creatorId: string | null = click?.creator_id ?? null;
        const userId: string | null = click?.user_id ?? null;

        // Commission split
        let creatorCommission = 0;
        let platformCommission = commissionAmount;

        if (creatorId) {
            // 50/50 split
            creatorCommission = parseFloat((commissionAmount * 0.5).toFixed(2));
            platformCommission = parseFloat((commissionAmount - creatorCommission).toFixed(2));
        }

        // Insert order
        const orderInsert = await db.query(
            `INSERT INTO orders (affiliate_order_id, commission_amount, creator_id, user_id, timestamp)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [affiliateOrderId, commissionAmount, creatorId, userId, orderTimestamp]
        );

        // Update creator commission balance if attributed
        if (creatorId && creatorCommission > 0) {
            await db.query(
                `UPDATE creators SET commission_balance = commission_balance + $1 WHERE id = $2`,
                [creatorCommission, creatorId]
            );
        }

        results.push({
            orderId: orderInsert.rows[0].id,
            affiliateOrderId,
            creatorId,
            creatorCommission,
            platformCommission,
        });
    }

    return results;
}
