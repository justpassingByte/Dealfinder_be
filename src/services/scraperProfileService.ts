import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import {
    ScrapeTelemetry,
    ScraperCommandStep,
    ScraperProfile,
    ScraperProfileCommandGuides,
    ScraperProfileEvent,
    ScraperProfileListItem,
    ScraperProfileStats,
    ScraperProfileStatus,
    ScraperProfileSummary,
    StoredScraperProfileStatus,
} from '../types/scraperProfile';
import { scraperProfileRepository } from './scraperProfileRepository';

type RunnableStatus = 'active' | 'warning';

export class ScraperProfileError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

interface CreateProfileInput {
    displayName: string;
    assignedWorkerId: string;
    profileMountName: string;
    containerProfilePath?: string;
    browserHost?: string;
    browserPort?: number;
    browserTargetPort?: number;
    debugTunnelPort?: number | null;
    notes?: string;
    defaultWarmupQuery?: string;
}

interface UpdateProfileInput {
    displayName?: string;
    assignedWorkerId?: string;
    profileMountName?: string;
    containerProfilePath?: string;
    browserHost?: string;
    browserPort?: number;
    browserTargetPort?: number;
    debugTunnelPort?: number | null;
    notes?: string | null;
    defaultWarmupQuery?: string | null;
}

function clampRisk(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function isRunnableStatus(status: ScraperProfileStatus): status is RunnableStatus {
    return status === 'active' || status === 'warning';
}

function deriveRiskStatus(riskScore: number): StoredScraperProfileStatus {
    if (riskScore >= 80) {
        return 'blocked';
    }
    if (riskScore >= 60) {
        return 'cooldown';
    }
    if (riskScore >= 30) {
        return 'warning';
    }
    return 'active';
}

function currentArchiveSuffix(): string {
    return new Date().toISOString().slice(0, 10);
}

export class ScraperProfileService {
    private readonly heartbeatIntervalMs = config.scraper.heartbeatIntervalSeconds * 1000;
    private readonly offlineTimeoutMs = config.scraper.offlineTimeoutSeconds * 1000;
    private readonly riskDecayIntervalMs = config.scraper.riskDecayIntervalMinutes * 60 * 1000;

    private enrichProfile<T extends ScraperProfile>(profile: T): T {
        const effectiveStatus = this.computeEffectiveStatus(profile);
        return {
            ...profile,
            effectiveStatus,
            isRunnable: isRunnableStatus(effectiveStatus),
        };
    }

    private computeEffectiveStatus(profile: ScraperProfile): ScraperProfileStatus {
        if (profile.archivedAt || profile.status === 'archived') {
            return 'archived';
        }

        if (!profile.lastHeartbeatAt) {
            return profile.status;
        }

        const lastHeartbeat = new Date(profile.lastHeartbeatAt).getTime();
        if (Date.now() - lastHeartbeat > this.offlineTimeoutMs) {
            return 'offline';
        }

        return profile.status;
    }

    private async applyTimedDecayIfNeeded(profile: ScraperProfile): Promise<ScraperProfile> {
        if (!['active', 'warning', 'cooldown'].includes(profile.status)) {
            return profile;
        }

        const lastRiskUpdatedAt = new Date(profile.lastRiskUpdatedAt).getTime();
        const elapsed = Date.now() - lastRiskUpdatedAt;
        const steps = Math.floor(elapsed / this.riskDecayIntervalMs);

        if (steps <= 0 || profile.riskScore <= 0) {
            return profile;
        }

        const decayAmount = Math.min(profile.riskScore, steps * config.scraper.riskDecayAmount);
        const nextRiskScore = clampRisk(profile.riskScore - decayAmount);
        const nextLastRiskUpdatedAt = new Date(lastRiskUpdatedAt + (steps * this.riskDecayIntervalMs));
        const nextStatus = profile.status === 'cooldown' ? 'cooldown' : deriveRiskStatus(nextRiskScore);

        const updatedProfile = await scraperProfileRepository.withTransaction(async (client) => {
            const next = await scraperProfileRepository.updateProfile(profile.id, {
                risk_score: nextRiskScore,
                status: nextStatus,
                last_risk_updated_at: nextLastRiskUpdatedAt,
            }, client);

            if (!next) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(profile.id, {
                eventType: 'risk_decay',
                oldStatus: profile.status,
                newStatus: nextStatus,
                riskDelta: -decayAmount,
                details: {
                    decaySteps: steps,
                    decayAmount,
                },
            }, client);

            return next;
        });

        return updatedProfile;
    }

    private async refreshProfile(profile: ScraperProfile): Promise<ScraperProfile> {
        const decayed = await this.applyTimedDecayIfNeeded(profile);
        return this.enrichProfile(decayed);
    }

    private async getProfileOrThrow(id: string): Promise<ScraperProfile> {
        const profile = await scraperProfileRepository.getProfileById(id);
        if (!profile) {
            throw new ScraperProfileError('Profile not found.', 404);
        }
        return this.refreshProfile(profile);
    }

    private ensureMutable(profile: ScraperProfile): void {
        if (profile.effectiveStatus === 'archived') {
            throw new ScraperProfileError('Archived profiles cannot be modified.', 409);
        }
    }

    private resolveWarmupQuery(profile: ScraperProfile, requestedQuery?: string | null): string {
        const cleanedRequested = requestedQuery?.trim();
        if (cleanedRequested) {
            return cleanedRequested;
        }

        const metadataQuery = typeof profile.metadata.defaultWarmupQuery === 'string'
            ? profile.metadata.defaultWarmupQuery.trim()
            : '';

        if (metadataQuery) {
            return metadataQuery;
        }

        return profile.displayName;
    }

    private buildCommandGuides(profile: ScraperProfile): ScraperProfileCommandGuides {
        const ops = config.scraper.ops;
        const profileDir = `${ops.vpsBasePath}/${profile.profileMountName}`;
        const archiveDir = `${ops.archiveBasePath}/${profile.profileMountName}_${currentArchiveSuffix()}`;
        const sshPrefix = ops.sshPort === 22 ? 'ssh' : `ssh -p ${ops.sshPort}`;
        const tunnelPort = profile.debugTunnelPort ?? profile.browserTargetPort;

        const add: ScraperCommandStep[] = [
            {
                title: 'Create profile directory',
                description: 'Run this on the VPS before you start or restart the worker.',
                command: `mkdir -p ${profileDir}`,
            },
            {
                title: 'Verify directory exists',
                description: 'Use this to confirm the mount path is present and writable.',
                command: `ls -la ${profileDir}`,
            },
            {
                title: 'Restart assigned worker',
                description: 'Restart the worker after the mount is ready or after you change the assignment.',
                command: `cd ${ops.dockerComposeDir}\ndocker compose restart ${profile.assignedWorkerId}`,
            },
        ];

        const recovery: ScraperCommandStep[] = [
            {
                title: 'Open SSH tunnel',
                description: 'Run this in your terminal, then return here and refresh targets in the dashboard.',
                command: `${sshPrefix} -L ${tunnelPort}:localhost:${tunnelPort} ${ops.sshUser}@${ops.sshHost}`,
            },
            {
                title: 'Verify DevTools target list',
                description: 'Optional terminal check if the dashboard cannot see targets yet.',
                command: `curl http://127.0.0.1:${tunnelPort}/json/list`,
            },
        ];

        const cleanup: ScraperCommandStep[] = [
            {
                title: 'Stop assigned worker first',
                description: 'Run this before moving or deleting the real browser profile folder on the VPS.',
                command: `cd ${ops.dockerComposeDir}\ndocker compose stop ${profile.assignedWorkerId}`,
            },
            {
                title: 'Move the profile directory out of service',
                description: 'This is the safe default. It keeps a backup before you delete the app record.',
                command: `mkdir -p ${ops.archiveBasePath}\nmv ${profileDir} ${archiveDir}`,
            },
            {
                title: 'Permanently delete the moved directory',
                description: 'Optional. Run this only after you verify you no longer need the archived browser session.',
                command: `rm -rf ${archiveDir}`,
            },
            {
                title: 'Bring the worker back with a new mount',
                description: 'Only run this if the worker still exists and you are attaching a replacement profile directory.',
                command: `cd ${ops.dockerComposeDir}\ndocker compose restart ${profile.assignedWorkerId}`,
            },
        ];

        return { add, recovery, cleanup };
    }

    async listProfiles(): Promise<ScraperProfileListItem[]> {
        const rawProfiles = await scraperProfileRepository.listProfiles();
        for (const profile of rawProfiles) {
            await this.applyTimedDecayIfNeeded(profile);
        }

        const refreshed = await scraperProfileRepository.listProfilesWithStats();
        return refreshed.map((profile) => ({
            ...this.enrichProfile(profile),
            stats: profile.stats,
        }));
    }

    async getSummary(): Promise<ScraperProfileSummary> {
        const profiles = await this.listProfiles();
        const totalRisk = profiles.reduce((sum, profile) => sum + profile.riskScore, 0);
        const captchaCount24h = await scraperProfileRepository.getCaptchaCount24h();

        return {
            totalProfiles: profiles.length,
            runnableProfiles: profiles.filter((profile) => profile.isRunnable).length,
            blockedProfiles: profiles.filter((profile) => profile.effectiveStatus === 'blocked').length,
            recoveringProfiles: profiles.filter((profile) => profile.effectiveStatus === 'recovering').length,
            warmingProfiles: profiles.filter((profile) => profile.effectiveStatus === 'warming').length,
            offlineProfiles: profiles.filter((profile) => profile.effectiveStatus === 'offline').length,
            archivedProfiles: profiles.filter((profile) => profile.effectiveStatus === 'archived').length,
            averageRisk: profiles.length > 0 ? Number((totalRisk / profiles.length).toFixed(2)) : 0,
            captchaCount24h,
        };
    }

    async createProfile(input: CreateProfileInput): Promise<ScraperProfile> {
        if (!input.displayName?.trim()) {
            throw new ScraperProfileError('displayName is required.', 400);
        }
        if (!input.assignedWorkerId?.trim()) {
            throw new ScraperProfileError('assignedWorkerId is required.', 400);
        }
        if (!input.profileMountName?.trim()) {
            throw new ScraperProfileError('profileMountName is required.', 400);
        }

        try {
            const profile = await scraperProfileRepository.withTransaction(async (client) => {
                const created = await scraperProfileRepository.createProfile({
                    id: uuidv4(),
                    display_name: input.displayName.trim(),
                    status: 'pending_setup',
                    risk_score: 0,
                    assigned_worker_id: input.assignedWorkerId.trim(),
                    profile_mount_name: input.profileMountName.trim(),
                    container_profile_path: input.containerProfilePath?.trim() || '/app/shopee_user_profile',
                    browser_host: input.browserHost?.trim() || '127.0.0.1',
                    browser_port: input.browserPort ?? 9222,
                    browser_target_port: input.browserTargetPort ?? 9223,
                    debug_tunnel_port: input.debugTunnelPort ?? null,
                    notes: input.notes?.trim() || null,
                    metadata_json: {
                        defaultWarmupQuery: input.defaultWarmupQuery?.trim() || undefined,
                    },
                }, client);

                await scraperProfileRepository.insertEvent(created.id, {
                    eventType: 'profile_created',
                    newStatus: created.status,
                    details: {
                        assignedWorkerId: created.assignedWorkerId,
                        profileMountName: created.profileMountName,
                    },
                }, client);

                return created;
            });

            return this.enrichProfile(profile);
        } catch (error: any) {
            if (error?.code === '23505') {
                throw new ScraperProfileError('assignedWorkerId must be unique.', 409);
            }
            throw error;
        }
    }

    async updateProfile(id: string, input: UpdateProfileInput): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const metadata = { ...profile.metadata };
        if (input.defaultWarmupQuery !== undefined) {
            if (input.defaultWarmupQuery) {
                metadata.defaultWarmupQuery = input.defaultWarmupQuery.trim();
            } else {
                delete metadata.defaultWarmupQuery;
            }
        }

        try {
            const updatedProfile = await scraperProfileRepository.withTransaction(async (client) => {
                const next = await scraperProfileRepository.updateProfile(profile.id, {
                    display_name: input.displayName?.trim() || profile.displayName,
                    assigned_worker_id: input.assignedWorkerId?.trim() || profile.assignedWorkerId,
                    profile_mount_name: input.profileMountName?.trim() || profile.profileMountName,
                    container_profile_path: input.containerProfilePath?.trim() || profile.containerProfilePath,
                    browser_host: input.browserHost?.trim() || profile.browserHost,
                    browser_port: input.browserPort ?? profile.browserPort,
                    browser_target_port: input.browserTargetPort ?? profile.browserTargetPort,
                    debug_tunnel_port: input.debugTunnelPort !== undefined ? input.debugTunnelPort : profile.debugTunnelPort,
                    notes: input.notes !== undefined ? input.notes : profile.notes,
                    metadata_json: metadata,
                }, client);

                if (!next) {
                    throw new ScraperProfileError('Profile not found.', 404);
                }

                await scraperProfileRepository.insertEvent(profile.id, {
                    eventType: 'profile_updated',
                    oldStatus: profile.status,
                    newStatus: next.status,
                    details: {
                        displayName: next.displayName,
                        assignedWorkerId: next.assignedWorkerId,
                    },
                }, client);

                return next;
            });

            return this.enrichProfile(updatedProfile);
        } catch (error: any) {
            if (error?.code === '23505') {
                throw new ScraperProfileError('assignedWorkerId must be unique.', 409);
            }
            throw error;
        }
    }

    async getProfileDetail(id: string): Promise<{
        profile: ScraperProfile;
        stats: ScraperProfileStats;
        recentEvents: ScraperProfileEvent[];
        commandGuides: ScraperProfileCommandGuides;
    }> {
        const profile = await this.getProfileOrThrow(id);
        const stats = await scraperProfileRepository.getProfileStats(id);
        const recentEvents = await scraperProfileRepository.getRecentEvents(id, 25);
        return {
            profile,
            stats,
            recentEvents,
            commandGuides: this.buildCommandGuides(profile),
        };
    }

    async getProfileStats(id: string): Promise<ScraperProfileStats> {
        await this.getProfileOrThrow(id);
        return scraperProfileRepository.getProfileStats(id);
    }

    async deleteProfile(id: string): Promise<void> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        if (profile.isRunnable && profile.lastHeartbeatAt) {
            throw new ScraperProfileError(
                'Profile is still claimed by a runnable worker. Move it out of active traffic before deleting it.',
                409,
            );
        }

        await scraperProfileRepository.withTransaction(async (client) => {
            const deleted = await scraperProfileRepository.deleteProfile(id, client);
            if (!deleted) {
                throw new ScraperProfileError('Profile not found.', 404);
            }
        });
    }

    async startRecovery(id: string): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const next = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(id, {
                status: 'recovering',
                recovery_started_at: new Date(),
                warmup_success_streak: 0,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(id, {
                eventType: 'recovery_started',
                oldStatus: profile.status,
                newStatus: 'recovering',
            }, client);

            return updated;
        });

        return this.enrichProfile(next);
    }

    async finishRecovery(id: string): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const next = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(id, {
                status: 'recovering',
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(id, {
                eventType: 'recovery_finished',
                oldStatus: profile.status,
                newStatus: 'recovering',
            }, client);

            return updated;
        });

        return this.enrichProfile(next);
    }

    async startWarmup(id: string, requestedWarmupQuery?: string): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const warmupQuery = this.resolveWarmupQuery(profile, requestedWarmupQuery);
        const metadata = {
            ...profile.metadata,
            pendingWarmupQuery: warmupQuery,
        };

        const next = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(id, {
                status: 'warming',
                warmup_requested_at: new Date(),
                warmup_success_streak: 0,
                metadata_json: metadata,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(id, {
                eventType: 'warmup_requested',
                oldStatus: profile.status,
                newStatus: 'warming',
                details: {
                    warmupQuery,
                },
            }, client);

            return updated;
        });

        return this.enrichProfile(next);
    }

    async resetRisk(id: string): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const nextStatus = profile.status === 'blocked' || profile.status === 'recovering' || profile.status === 'warming'
            ? profile.status
            : 'active';

        const next = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(id, {
                risk_score: 0,
                status: nextStatus,
                last_risk_updated_at: new Date(),
                cooldown_until: null,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(id, {
                eventType: 'risk_reset',
                oldStatus: profile.status,
                newStatus: nextStatus,
                riskDelta: -profile.riskScore,
            }, client);

            return updated;
        });

        return this.enrichProfile(next);
    }

    async overrideStatus(id: string, status: StoredScraperProfileStatus, notes?: string): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(id);
        this.ensureMutable(profile);

        const next = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(id, {
                status,
                notes: notes !== undefined ? notes : profile.notes,
                cooldown_until: status === 'cooldown'
                    ? new Date(Date.now() + this.riskDecayIntervalMs)
                    : null,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(id, {
                eventType: 'status_overridden',
                oldStatus: profile.status,
                newStatus: status,
                details: notes ? { notes } : {},
            }, client);

            return updated;
        });

        return this.enrichProfile(next);
    }

    async getWorkerProfile(workerId: string): Promise<ScraperProfile | null> {
        const profile = await scraperProfileRepository.getProfileByWorkerId(workerId);
        if (!profile) {
            return null;
        }

        return this.refreshProfile(profile);
    }

    async claimWorkerProfile(workerId: string): Promise<ScraperProfile | null> {
        const profile = await scraperProfileRepository.getProfileByWorkerId(workerId);
        if (!profile) {
            return null;
        }

        const now = new Date();
        const claimed = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(profile.id, {
                last_heartbeat_at: now,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(profile.id, {
                eventType: 'worker_claimed',
                oldStatus: profile.status,
                newStatus: updated.status,
                details: {
                    workerId,
                },
            }, client);

            return updated;
        });

        return this.refreshProfile(claimed);
    }

    async heartbeatWorker(workerId: string): Promise<ScraperProfile | null> {
        const profile = await scraperProfileRepository.getProfileByWorkerId(workerId);
        if (!profile) {
            return null;
        }

        const updated = await scraperProfileRepository.updateProfile(profile.id, {
            last_heartbeat_at: new Date(),
        });

        return updated ? this.refreshProfile(updated) : null;
    }

    async releaseWorker(workerId: string, reason = 'shutdown'): Promise<void> {
        const profile = await scraperProfileRepository.getProfileByWorkerId(workerId);
        if (!profile) {
            return;
        }

        await scraperProfileRepository.insertEvent(profile.id, {
            eventType: 'worker_released',
            oldStatus: profile.status,
            newStatus: profile.status,
            details: {
                workerId,
                reason,
            },
        });
    }

    private calculateRiskOutcome(profile: ScraperProfile, telemetry: ScrapeTelemetry, query: string): {
        nextRiskScore: number;
        nextStatus: StoredScraperProfileStatus;
        riskDelta: number;
        eventType: string;
        cooldownUntil: Date | null;
        success: boolean;
    } {
        let riskDelta = 1;
        let eventType = 'scrape_failure';
        let success = false;

        if (telemetry.latencyMs > 1500) {
            riskDelta += 5;
        }

        if (telemetry.blocked) {
            riskDelta += 60;
            eventType = 'scrape_blocked';
        } else if (telemetry.failureReason) {
            riskDelta += 10;
        } else if (telemetry.processedListingCount === 0 && !query.toLowerCase().startsWith('http')) {
            riskDelta += 15;
        } else if (telemetry.processedListingCount > 0) {
            riskDelta -= 4;
            eventType = 'scrape_success';
            success = true;
        }

        const nextRiskScore = clampRisk(profile.riskScore + riskDelta);
        const nextStatus = telemetry.blocked ? 'blocked' : deriveRiskStatus(nextRiskScore);
        const cooldownUntil = nextStatus === 'cooldown'
            ? new Date(Date.now() + this.riskDecayIntervalMs)
            : null;

        return {
            nextRiskScore,
            nextStatus,
            riskDelta,
            eventType,
            cooldownUntil,
            success,
        };
    }

    async reportScrapeOutcome(
        profileId: string,
        query: string,
        telemetry: ScrapeTelemetry,
        isWarmup = false,
    ): Promise<ScraperProfile> {
        const profile = await this.getProfileOrThrow(profileId);
        this.ensureMutable(profile);

        if (isWarmup) {
            return this.reportWarmupOutcome(profile, query, telemetry);
        }

        const outcome = this.calculateRiskOutcome(profile, telemetry, query);
        const now = new Date();

        const nextProfile = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(profile.id, {
                risk_score: outcome.nextRiskScore,
                status: outcome.nextStatus,
                cooldown_until: outcome.cooldownUntil,
                warmup_success_streak: 0,
                last_used_at: now,
                last_success_at: outcome.success ? now : profile.lastSuccessAt,
                last_failure_at: !outcome.success ? now : profile.lastFailureAt,
                last_captcha_at: telemetry.blocked ? now : profile.lastCaptchaAt,
                last_risk_updated_at: now,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(profile.id, {
                eventType: outcome.eventType,
                oldStatus: profile.status,
                newStatus: outcome.nextStatus,
                riskDelta: outcome.riskDelta,
                latencyMs: telemetry.latencyMs,
                details: {
                    query,
                    blocked: telemetry.blocked,
                    failureReason: telemetry.failureReason,
                    rawListingCount: telemetry.rawListingCount,
                    processedListingCount: telemetry.processedListingCount,
                },
            }, client);

            return updated;
        });

        return this.enrichProfile(nextProfile);
    }

    private async reportWarmupOutcome(
        profile: ScraperProfile,
        query: string,
        telemetry: ScrapeTelemetry,
    ): Promise<ScraperProfile> {
        const lowRiskSuccess = !telemetry.blocked
            && !telemetry.failureReason
            && telemetry.processedListingCount > 0
            && telemetry.latencyMs <= 1500;

        let nextRiskScore = profile.riskScore;
        let nextStatus: StoredScraperProfileStatus = profile.status;
        let nextWarmupStreak = 0;
        let riskDelta = 0;
        let eventType = 'warmup_failure';
        const now = new Date();

        if (telemetry.blocked) {
            nextRiskScore = clampRisk(profile.riskScore + 61);
            nextStatus = 'blocked';
            riskDelta = nextRiskScore - profile.riskScore;
            eventType = 'warmup_blocked';
        } else if (lowRiskSuccess) {
            nextRiskScore = clampRisk(profile.riskScore - 4);
            nextWarmupStreak = profile.warmupSuccessStreak + 1;
            riskDelta = nextRiskScore - profile.riskScore;
            eventType = 'warmup_success';
            if (nextWarmupStreak >= config.scraper.warmupSuccessThreshold && nextRiskScore < 60) {
                nextStatus = deriveRiskStatus(nextRiskScore);
            } else {
                nextStatus = 'warming';
            }
        } else {
            nextRiskScore = clampRisk(profile.riskScore + 16);
            nextStatus = 'warming';
            riskDelta = nextRiskScore - profile.riskScore;
            eventType = 'warmup_failure';
        }

        const metadata = { ...profile.metadata };
        if (nextStatus !== 'warming') {
            delete metadata.pendingWarmupQuery;
        }

        const nextProfile = await scraperProfileRepository.withTransaction(async (client) => {
            const updated = await scraperProfileRepository.updateProfile(profile.id, {
                risk_score: nextRiskScore,
                status: nextStatus,
                warmup_success_streak: nextWarmupStreak,
                last_used_at: now,
                last_success_at: eventType === 'warmup_success' ? now : profile.lastSuccessAt,
                last_failure_at: eventType === 'warmup_failure' ? now : profile.lastFailureAt,
                last_captcha_at: eventType === 'warmup_blocked' ? now : profile.lastCaptchaAt,
                last_risk_updated_at: now,
                cooldown_until: nextStatus === 'cooldown' ? new Date(Date.now() + this.riskDecayIntervalMs) : null,
                metadata_json: metadata,
            }, client);

            if (!updated) {
                throw new ScraperProfileError('Profile not found.', 404);
            }

            await scraperProfileRepository.insertEvent(profile.id, {
                eventType,
                oldStatus: profile.status,
                newStatus: nextStatus,
                riskDelta,
                latencyMs: telemetry.latencyMs,
                details: {
                    query,
                    blocked: telemetry.blocked,
                    failureReason: telemetry.failureReason,
                    processedListingCount: telemetry.processedListingCount,
                    warmupSuccessStreak: nextWarmupStreak,
                },
            }, client);

            return updated;
        });

        return this.enrichProfile(nextProfile);
    }

    async getPendingWarmupQuery(workerId: string): Promise<{ profile: ScraperProfile; query: string } | null> {
        const profile = await this.getWorkerProfile(workerId);
        if (!profile || profile.status !== 'warming') {
            return null;
        }

        const query = typeof profile.metadata.pendingWarmupQuery === 'string'
            ? profile.metadata.pendingWarmupQuery.trim()
            : '';

        if (!query) {
            return null;
        }

        return { profile, query };
    }

    getHeartbeatIntervalMs(): number {
        return this.heartbeatIntervalMs;
    }
}

export const scraperProfileService = new ScraperProfileService();
