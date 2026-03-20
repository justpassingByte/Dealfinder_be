import { PoolClient, QueryResult } from 'pg';
import { db } from '../config/db';
import {
    ScraperProfile,
    ScraperProfileEvent,
    ScraperProfileListItem,
    ScraperProfileMetadata,
    ScraperProfileStats,
    StoredScraperProfileStatus,
} from '../types/scraperProfile';

interface Queryable {
    query: (text: string, params?: unknown[]) => Promise<QueryResult>;
}

function getExecutor(executor?: Queryable): Queryable {
    return executor ?? db;
}

function mapProfileRow(row: any): ScraperProfile {
    return {
        id: row.id,
        displayName: row.display_name,
        status: row.status as StoredScraperProfileStatus,
        effectiveStatus: (row.effective_status ?? row.status) as ScraperProfile['effectiveStatus'],
        riskScore: Number(row.risk_score ?? 0),
        assignedWorkerId: row.assigned_worker_id,
        profileMountName: row.profile_mount_name,
        containerProfilePath: row.container_profile_path,
        browserHost: row.browser_host,
        browserPort: Number(row.browser_port),
        browserTargetPort: Number(row.browser_target_port),
        debugTunnelPort: row.debug_tunnel_port !== null ? Number(row.debug_tunnel_port) : null,
        lastHeartbeatAt: row.last_heartbeat_at ?? null,
        lastUsedAt: row.last_used_at ?? null,
        lastSuccessAt: row.last_success_at ?? null,
        lastFailureAt: row.last_failure_at ?? null,
        lastCaptchaAt: row.last_captcha_at ?? null,
        cooldownUntil: row.cooldown_until ?? null,
        recoveryStartedAt: row.recovery_started_at ?? null,
        warmupRequestedAt: row.warmup_requested_at ?? null,
        warmupSuccessStreak: Number(row.warmup_success_streak ?? 0),
        lastRiskUpdatedAt: row.last_risk_updated_at,
        archivedAt: row.archived_at ?? null,
        notes: row.notes ?? null,
        metadata: (row.metadata_json ?? {}) as ScraperProfileMetadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isRunnable: false,
    };
}

function mapListItemRow(row: any): ScraperProfileListItem {
    return {
        ...mapProfileRow(row),
        stats: {
            requestCount24h: Number(row.request_count_24h ?? 0),
            successRate24h: Number(row.success_rate_24h ?? 0),
            captchaCount24h: Number(row.captcha_count_24h ?? 0),
        },
    };
}

function mapEventRow(row: any): ScraperProfileEvent {
    return {
        id: row.id,
        profileId: row.profile_id,
        eventType: row.event_type,
        oldStatus: row.old_status ?? null,
        newStatus: row.new_status ?? null,
        riskDelta: Number(row.risk_delta ?? 0),
        latencyMs: row.latency_ms !== null ? Number(row.latency_ms) : null,
        details: (row.details_json ?? {}) as Record<string, unknown>,
        createdAt: row.created_at,
    };
}

function serializeValue(value: unknown): unknown {
    if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        return JSON.stringify(value);
    }
    return value;
}

function buildUpdateClause(patch: Record<string, unknown>): { clause: string; values: unknown[] } {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
        return { clause: '', values: [] };
    }

    const assignments = entries.map(([column], index) => {
        const parameterIndex = index + 2;
        const castSuffix = column.endsWith('_json') ? '::jsonb' : '';
        return `${column} = $${parameterIndex}${castSuffix}`;
    });

    return {
        clause: `${assignments.join(', ')}, updated_at = NOW()`,
        values: entries.map(([, value]) => serializeValue(value)),
    };
}

export const scraperProfileRepository = {
    async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async createProfile(profile: Record<string, unknown>, executor?: Queryable): Promise<ScraperProfile> {
        const sql = `
            INSERT INTO scraper_profiles (
                id,
                display_name,
                status,
                risk_score,
                assigned_worker_id,
                profile_mount_name,
                container_profile_path,
                browser_host,
                browser_port,
                browser_target_port,
                debug_tunnel_port,
                notes,
                metadata_json
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
            )
            RETURNING *
        `;

        const result = await getExecutor(executor).query(sql, [
            profile.id,
            profile.display_name,
            profile.status,
            profile.risk_score,
            profile.assigned_worker_id,
            profile.profile_mount_name,
            profile.container_profile_path,
            profile.browser_host,
            profile.browser_port,
            profile.browser_target_port,
            profile.debug_tunnel_port ?? null,
            profile.notes ?? null,
            JSON.stringify(profile.metadata_json ?? {}),
        ]);

        return mapProfileRow(result.rows[0]);
    },

    async updateProfile(id: string, patch: Record<string, unknown>, executor?: Queryable): Promise<ScraperProfile | null> {
        const { clause, values } = buildUpdateClause(patch);
        if (!clause) {
            return this.getProfileById(id, executor);
        }

        const sql = `
            UPDATE scraper_profiles
            SET ${clause}
            WHERE id = $1
            RETURNING *
        `;

        const result = await getExecutor(executor).query(sql, [id, ...values]);
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
    },

    async deleteProfile(id: string, executor?: Queryable): Promise<boolean> {
        const result = await getExecutor(executor).query(
            'DELETE FROM scraper_profiles WHERE id = $1',
            [id],
        );
        return (result.rowCount ?? 0) > 0;
    },

    async getProfileById(id: string, executor?: Queryable): Promise<ScraperProfile | null> {
        const result = await getExecutor(executor).query(
            'SELECT * FROM scraper_profiles WHERE id = $1 LIMIT 1',
            [id],
        );
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
    },

    async getProfileByWorkerId(workerId: string, executor?: Queryable): Promise<ScraperProfile | null> {
        const result = await getExecutor(executor).query(
            `
                SELECT *
                FROM scraper_profiles
                WHERE assigned_worker_id = $1
                AND archived_at IS NULL
                LIMIT 1
            `,
            [workerId],
        );
        return result.rows[0] ? mapProfileRow(result.rows[0]) : null;
    },

    async listProfiles(includeArchived = true, executor?: Queryable): Promise<ScraperProfile[]> {
        const result = await getExecutor(executor).query(
            `
                SELECT *
                FROM scraper_profiles
                WHERE $1::boolean = true OR archived_at IS NULL
                ORDER BY
                    CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
                    display_name ASC
            `,
            [includeArchived],
        );
        return result.rows.map(mapProfileRow);
    },

    async listProfilesWithStats(includeArchived = true, executor?: Queryable): Promise<ScraperProfileListItem[]> {
        const result = await getExecutor(executor).query(
            `
                SELECT
                    p.*,
                    COALESCE(s.request_count_24h, 0) AS request_count_24h,
                    COALESCE(s.success_rate_24h, 0) AS success_rate_24h,
                    COALESCE(s.captcha_count_24h, 0) AS captcha_count_24h
                FROM scraper_profiles p
                LEFT JOIN (
                    SELECT
                        profile_id,
                        COUNT(*) FILTER (
                            WHERE event_type IN ('scrape_success', 'scrape_failure', 'scrape_blocked')
                        ) AS request_count_24h,
                        COALESCE(
                            ROUND(
                                (
                                    COUNT(*) FILTER (WHERE event_type = 'scrape_success')::numeric
                                    /
                                    NULLIF(
                                        COUNT(*) FILTER (
                                            WHERE event_type IN ('scrape_success', 'scrape_failure', 'scrape_blocked')
                                        ),
                                        0
                                    )::numeric
                                ) * 100,
                                2
                            ),
                            0
                        ) AS success_rate_24h,
                        COUNT(*) FILTER (
                            WHERE event_type IN ('scrape_blocked', 'warmup_blocked')
                        ) AS captcha_count_24h
                    FROM scraper_profile_events
                    WHERE created_at >= NOW() - INTERVAL '24 hours'
                    GROUP BY profile_id
                ) s ON s.profile_id = p.id
                WHERE $1::boolean = true OR p.archived_at IS NULL
                ORDER BY
                    CASE WHEN p.archived_at IS NULL THEN 0 ELSE 1 END,
                    p.display_name ASC
            `,
            [includeArchived],
        );
        return result.rows.map(mapListItemRow);
    },

    async getProfileStats(profileId: string, executor?: Queryable): Promise<ScraperProfileStats> {
        const result = await getExecutor(executor).query(
            `
                SELECT
                    COUNT(*) FILTER (
                        WHERE event_type IN ('scrape_success', 'scrape_failure', 'scrape_blocked')
                    ) AS request_count_24h,
                    COUNT(*) FILTER (WHERE event_type = 'scrape_success') AS success_count_24h,
                    COALESCE(
                        ROUND(
                            (
                                COUNT(*) FILTER (WHERE event_type = 'scrape_success')::numeric
                                /
                                NULLIF(
                                    COUNT(*) FILTER (
                                        WHERE event_type IN ('scrape_success', 'scrape_failure', 'scrape_blocked')
                                    ),
                                    0
                                )::numeric
                            ) * 100,
                            2
                        ),
                        0
                    ) AS success_rate_24h,
                    COUNT(*) FILTER (
                        WHERE event_type IN ('scrape_blocked', 'warmup_blocked')
                    ) AS captcha_count_24h,
                    ROUND(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 2) AS average_latency_24h
                FROM scraper_profile_events
                WHERE profile_id = $1
                AND created_at >= NOW() - INTERVAL '24 hours'
            `,
            [profileId],
        );

        const profile = await this.getProfileById(profileId, executor);
        const row = result.rows[0] ?? {};

        return {
            requestCount24h: Number(row.request_count_24h ?? 0),
            successCount24h: Number(row.success_count_24h ?? 0),
            successRate24h: Number(row.success_rate_24h ?? 0),
            captchaCount24h: Number(row.captcha_count_24h ?? 0),
            averageLatency24h: row.average_latency_24h !== null && row.average_latency_24h !== undefined
                ? Number(row.average_latency_24h)
                : null,
            currentWarmupStreak: profile?.warmupSuccessStreak ?? 0,
            lastSuccessAt: profile?.lastSuccessAt ?? null,
            lastFailureAt: profile?.lastFailureAt ?? null,
            lastCaptchaAt: profile?.lastCaptchaAt ?? null,
        };
    },

    async getCaptchaCount24h(executor?: Queryable): Promise<number> {
        const result = await getExecutor(executor).query(
            `
                SELECT COUNT(*) AS captcha_count_24h
                FROM scraper_profile_events
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                AND event_type IN ('scrape_blocked', 'warmup_blocked')
            `,
        );
        return Number(result.rows[0]?.captcha_count_24h ?? 0);
    },

    async insertEvent(
        profileId: string,
        event: {
            eventType: string;
            oldStatus?: string | null;
            newStatus?: string | null;
            riskDelta?: number;
            latencyMs?: number | null;
            details?: Record<string, unknown>;
        },
        executor?: Queryable,
    ): Promise<void> {
        await getExecutor(executor).query(
            `
                INSERT INTO scraper_profile_events (
                    profile_id,
                    event_type,
                    old_status,
                    new_status,
                    risk_delta,
                    latency_ms,
                    details_json
                ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            `,
            [
                profileId,
                event.eventType,
                event.oldStatus ?? null,
                event.newStatus ?? null,
                event.riskDelta ?? 0,
                event.latencyMs ?? null,
                JSON.stringify(event.details ?? {}),
            ],
        );
    },

    async getRecentEvents(profileId: string, limit = 25, executor?: Queryable): Promise<ScraperProfileEvent[]> {
        const result = await getExecutor(executor).query(
            `
                SELECT *
                FROM scraper_profile_events
                WHERE profile_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            `,
            [profileId, limit],
        );
        return result.rows.map(mapEventRow);
    },
};
