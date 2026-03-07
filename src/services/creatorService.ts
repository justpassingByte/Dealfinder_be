import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ──────────────────────────────────────────────────
export interface CreatorRow {
    id: string;
    user_id: string;
    referral_code: string;
    commission_balance: number;
    created_at: Date;
}

export interface CreatorDashboardStats {
    totalClicks: number;
    totalOrders: number;
    totalCommission: number;
    commissionBalance: number;
}

export interface ClickRow {
    id: string;
    product_url: string;
    timestamp: Date;
    ip: string;
}

export interface OrderRow {
    id: string;
    affiliate_order_id: string;
    commission_amount: number;
    timestamp: Date;
}

// ─── Generator ──────────────────────────────────────────────
function generateReferralCode(): string {
    return `DF-${uuidv4().slice(0, 8).toUpperCase()}`;
}

// ─── DB operations ──────────────────────────────────────────
export async function findCreatorByUserId(userId: string): Promise<CreatorRow | null> {
    const result = await db.query('SELECT * FROM creators WHERE user_id = $1', [userId]);
    return result.rows[0] ?? null;
}

export async function findCreatorByCode(code: string): Promise<CreatorRow | null> {
    const result = await db.query('SELECT * FROM creators WHERE referral_code = $1', [code]);
    return result.rows[0] ?? null;
}

export async function findCreatorById(id: string): Promise<CreatorRow | null> {
    const result = await db.query('SELECT * FROM creators WHERE id = $1', [id]);
    return result.rows[0] ?? null;
}

/**
 * Onboard a user as a creator. Generates a unique referral code.
 */
export async function onboardCreator(userId: string): Promise<CreatorRow> {
    // Check if already a creator
    const existing = await findCreatorByUserId(userId);
    if (existing) {
        throw new Error('User is already a creator.');
    }

    const referralCode = generateReferralCode();
    const result = await db.query(
        `INSERT INTO creators (user_id, referral_code)
         VALUES ($1, $2)
         RETURNING *`,
        [userId, referralCode]
    );
    return result.rows[0];
}

/**
 * Get dashboard stats for a creator.
 */
export async function getCreatorStats(creatorId: string): Promise<CreatorDashboardStats> {
    const [clicksRes, ordersRes, creatorRes] = await Promise.all([
        db.query('SELECT COUNT(*) as count FROM clicks WHERE creator_id = $1', [creatorId]),
        db.query(
            'SELECT COUNT(*) as count, COALESCE(SUM(commission_amount), 0) as total FROM orders WHERE creator_id = $1',
            [creatorId]
        ),
        db.query('SELECT commission_balance FROM creators WHERE id = $1', [creatorId]),
    ]);

    return {
        totalClicks: parseInt(clicksRes.rows[0].count, 10),
        totalOrders: parseInt(ordersRes.rows[0].count, 10),
        totalCommission: parseFloat(ordersRes.rows[0].total),
        commissionBalance: parseFloat(creatorRes.rows[0]?.commission_balance ?? '0'),
    };
}

/**
 * Get recent clicks for a creator (last 50).
 */
export async function getCreatorClicks(creatorId: string, limit = 50): Promise<ClickRow[]> {
    const result = await db.query(
        'SELECT id, product_url, timestamp, ip FROM clicks WHERE creator_id = $1 ORDER BY timestamp DESC LIMIT $2',
        [creatorId, limit]
    );
    return result.rows;
}

/**
 * Get recent orders for a creator (last 50).
 */
export async function getCreatorOrders(creatorId: string, limit = 50): Promise<OrderRow[]> {
    const result = await db.query(
        'SELECT id, affiliate_order_id, commission_amount, timestamp FROM orders WHERE creator_id = $1 ORDER BY timestamp DESC LIMIT $2',
        [creatorId, limit]
    );
    return result.rows;
}
