import { db } from '../config/db';

export interface ClickData {
    userId?: string | null;
    creatorId?: string | null;
    productUrl: string;
    ip: string;
    userAgent: string;
}

/**
 * Log a click event into the clicks table.
 */
export async function logClick(data: ClickData): Promise<string> {
    const result = await db.query(
        `INSERT INTO clicks (user_id, creator_id, product_url, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
        [data.userId ?? null, data.creatorId ?? null, data.productUrl, data.ip, data.userAgent]
    );
    return result.rows[0].id as string;
}
