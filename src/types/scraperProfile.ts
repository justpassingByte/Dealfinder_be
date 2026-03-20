export type ScraperProfileStatus =
    | 'pending_setup'
    | 'active'
    | 'warning'
    | 'blocked'
    | 'recovering'
    | 'warming'
    | 'cooldown'
    | 'offline'
    | 'archived';

export type StoredScraperProfileStatus = Exclude<ScraperProfileStatus, 'offline'>;

export interface ScraperProfileMetadata {
    debugHost?: string;
    defaultWarmupQuery?: string;
    pendingWarmupQuery?: string;
    [key: string]: unknown;
}

export interface ScraperProfileStats {
    requestCount24h: number;
    successCount24h: number;
    successRate24h: number;
    captchaCount24h: number;
    averageLatency24h: number | null;
    currentWarmupStreak: number;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    lastCaptchaAt: Date | null;
}

export interface ScraperProfileSummary {
    totalProfiles: number;
    runnableProfiles: number;
    blockedProfiles: number;
    recoveringProfiles: number;
    warmingProfiles: number;
    offlineProfiles: number;
    archivedProfiles: number;
    averageRisk: number;
    captchaCount24h: number;
}

export interface ScraperProfileEvent {
    id: string;
    profileId: string;
    eventType: string;
    oldStatus: string | null;
    newStatus: string | null;
    riskDelta: number;
    latencyMs: number | null;
    details: Record<string, unknown>;
    createdAt: Date;
}

export interface ScraperProfile {
    id: string;
    displayName: string;
    status: StoredScraperProfileStatus;
    effectiveStatus: ScraperProfileStatus;
    riskScore: number;
    assignedWorkerId: string;
    profileMountName: string;
    containerProfilePath: string;
    browserHost: string;
    browserPort: number;
    browserTargetPort: number;
    debugTunnelPort: number | null;
    lastHeartbeatAt: Date | null;
    lastUsedAt: Date | null;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    lastCaptchaAt: Date | null;
    cooldownUntil: Date | null;
    recoveryStartedAt: Date | null;
    warmupRequestedAt: Date | null;
    warmupSuccessStreak: number;
    lastRiskUpdatedAt: Date;
    archivedAt: Date | null;
    notes: string | null;
    metadata: ScraperProfileMetadata;
    createdAt: Date;
    updatedAt: Date;
    isRunnable: boolean;
}

export interface ScraperProfileListItem extends ScraperProfile {
    stats: {
        requestCount24h: number;
        successRate24h: number;
        captchaCount24h: number;
    };
}

export interface ScraperCommandStep {
    title: string;
    description: string;
    command: string;
}

export interface ScraperProfileCommandGuides {
    add: ScraperCommandStep[];
    recovery: ScraperCommandStep[];
    cleanup: ScraperCommandStep[];
}

export interface DevtoolsTarget {
    id: string;
    title: string;
    type: string;
    url: string;
    localInspectorUrl: string;
}

export interface DevtoolsStatus {
    reachable: boolean;
    checkedAt: Date;
    debugHost: string;
    debugPort: number;
    localTunnelPort: number;
    targetCount: number;
    recommendedTargetId: string | null;
    error: string | null;
}

export interface ScrapeTelemetry {
    listings: import('./listing').Listing[];
    latencyMs: number;
    blocked: boolean;
    failureReason: string | null;
    rawListingCount: number;
    processedListingCount: number;
}
