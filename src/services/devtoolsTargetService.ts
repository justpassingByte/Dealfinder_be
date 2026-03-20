import { DevtoolsTarget, ScraperProfile } from '../types/scraperProfile';

interface ChromeTarget {
    id: string;
    title?: string;
    type?: string;
    url?: string;
}

function isNoiseTarget(target: ChromeTarget): boolean {
    const url = target.url ?? '';
    return target.type === 'iframe'
        || url.includes('doubleclick.net')
        || url.includes('googlesyndication.com');
}

export class DevtoolsTargetService {
    async listTargets(profile: ScraperProfile): Promise<DevtoolsTarget[]> {
        const debugHost = typeof profile.metadata.debugHost === 'string' && profile.metadata.debugHost.trim()
            ? profile.metadata.debugHost.trim()
            : profile.assignedWorkerId;

        const response = await fetch(`http://${debugHost}:${profile.browserTargetPort}/json/list`);
        if (!response.ok) {
            throw new Error(`Failed to fetch DevTools targets (${response.status}).`);
        }

        const targets = await response.json() as ChromeTarget[];
        const preferredTargets = targets.filter((target) => target.type === 'page');
        const visibleTargets = (preferredTargets.length > 0 ? preferredTargets : targets)
            .filter((target) => !isNoiseTarget(target));
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
