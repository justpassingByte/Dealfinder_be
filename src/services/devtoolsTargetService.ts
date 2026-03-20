import { DevtoolsStatus, DevtoolsTarget, ScraperProfile } from '../types/scraperProfile';

interface ChromeTarget {
    id: string;
    title?: string;
    type?: string;
    url?: string;
}

function resolveDebugHost(profile: ScraperProfile): string {
    return typeof profile.metadata.debugHost === 'string' && profile.metadata.debugHost.trim()
        ? profile.metadata.debugHost.trim()
        : profile.assignedWorkerId;
}

function isNoiseTarget(target: ChromeTarget): boolean {
    const url = target.url ?? '';
    return target.type === 'iframe'
        || url.includes('doubleclick.net')
        || url.includes('googlesyndication.com');
}

function filterVisibleTargets(targets: ChromeTarget[]): ChromeTarget[] {
    const preferredTargets = targets.filter((target) => target.type === 'page');
    return (preferredTargets.length > 0 ? preferredTargets : targets)
        .filter((target) => !isNoiseTarget(target));
}

async function fetchChromeTargets(debugHost: string, debugPort: number): Promise<ChromeTarget[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
        const response = await fetch(`http://${debugHost}:${debugPort}/json/list`, {
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch DevTools targets (${response.status}).`);
        }

        return await response.json() as ChromeTarget[];
    } finally {
        clearTimeout(timeout);
    }
}

export class DevtoolsTargetService {
    async checkStatus(profile: ScraperProfile): Promise<DevtoolsStatus> {
        const debugHost = resolveDebugHost(profile);
        const debugPort = profile.browserTargetPort;
        const localTunnelPort = profile.debugTunnelPort ?? profile.browserTargetPort;

        try {
            const rawTargets = await fetchChromeTargets(debugHost, debugPort);
            const visibleTargets = filterVisibleTargets(rawTargets);

            return {
                reachable: true,
                checkedAt: new Date(),
                debugHost,
                debugPort,
                localTunnelPort,
                targetCount: visibleTargets.length,
                recommendedTargetId: visibleTargets[0]?.id ?? null,
                error: null,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to reach the worker debug endpoint.';
            return {
                reachable: false,
                checkedAt: new Date(),
                debugHost,
                debugPort,
                localTunnelPort,
                targetCount: 0,
                recommendedTargetId: null,
                error: message,
            };
        }
    }

    async listTargets(profile: ScraperProfile): Promise<DevtoolsTarget[]> {
        const debugHost = resolveDebugHost(profile);
        const rawTargets = await fetchChromeTargets(debugHost, profile.browserTargetPort);
        const visibleTargets = filterVisibleTargets(rawTargets);
        const localPort = profile.debugTunnelPort ?? profile.browserTargetPort;

        return visibleTargets.map((target) => ({
            id: target.id,
            title: target.title || target.url || 'Untitled target',
            type: target.type || 'page',
            url: target.url || '',
            localInspectorUrl: `http://127.0.0.1:${localPort}/devtools/inspector.html?ws=127.0.0.1:${localPort}/devtools/page/${target.id}`,
        }));
    }
}

export const devtoolsTargetService = new DevtoolsTargetService();
