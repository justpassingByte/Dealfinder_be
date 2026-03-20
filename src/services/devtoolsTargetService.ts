import http from 'node:http';
import { DevtoolsStatus, DevtoolsTarget, ScraperProfile } from '../types/scraperProfile';

interface ChromeTarget {
    id: string;
    title?: string;
    type?: string;
    url?: string;
}

interface DebugEndpointCandidate {
    host: string;
    port: number;
}

interface ResolvedChromeTargets {
    debugHost: string;
    debugPort: number;
    targets: ChromeTarget[];
}

function resolveDebugHost(profile: ScraperProfile): string | null {
    if (typeof profile.metadata.debugHost === 'string' && profile.metadata.debugHost.trim()) {
        return profile.metadata.debugHost.trim();
    }

    return null;
}

function buildDebugEndpointCandidates(profile: ScraperProfile): DebugEndpointCandidate[] {
    const candidates: DebugEndpointCandidate[] = [];
    const seen = new Set<string>();

    function push(host: string | null | undefined, port: number | null | undefined): void {
        if (!host || !port) {
            return;
        }

        const key = `${host}:${port}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        candidates.push({ host, port });
    }

    push(resolveDebugHost(profile), profile.browserTargetPort);
    push(profile.assignedWorkerId, profile.browserTargetPort);
    push('host.docker.internal', profile.debugTunnelPort ?? profile.browserTargetPort);
    push('127.0.0.1', profile.debugTunnelPort ?? profile.browserTargetPort);

    return candidates;
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

async function fetchChromeTargets(profile: ScraperProfile, debugHost: string, debugPort: number): Promise<ChromeTarget[]> {
    const hostHeaderPort = profile.debugTunnelPort ?? profile.browserPort;
    const hostHeader = `${profile.browserHost}:${hostHeaderPort}`;

    return new Promise<ChromeTarget[]>((resolve, reject) => {
        const request = http.request({
            host: debugHost,
            port: debugPort,
            path: '/json/list',
            method: 'GET',
            timeout: 4000,
            headers: {
                Host: hostHeader,
                Connection: 'close',
            },
        }, (response) => {
            let body = '';

            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
                    reject(new Error(`Failed to fetch DevTools targets (${response.statusCode ?? 500}). Preview: ${body.slice(0, 160)}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body) as ChromeTarget[]);
                } catch (error) {
                    reject(new Error(`DevTools returned invalid JSON. Preview: ${body.slice(0, 160)}`));
                }
            });
        });

        request.on('timeout', () => {
            request.destroy(new Error('DevTools request timed out.'));
        });
        request.on('error', (error) => {
            reject(error);
        });
        request.end();
    });
}

async function resolveChromeTargets(profile: ScraperProfile): Promise<ResolvedChromeTargets> {
    const candidates = buildDebugEndpointCandidates(profile);
    const errors: string[] = [];

    for (const candidate of candidates) {
        try {
            const targets = await fetchChromeTargets(profile, candidate.host, candidate.port);
            return {
                debugHost: candidate.host,
                debugPort: candidate.port,
                targets,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown DevTools fetch error.';
            errors.push(`${candidate.host}:${candidate.port} -> ${message}`);
        }
    }

    throw new Error(errors.join(' | ') || 'Unable to reach any DevTools endpoint for this profile.');
}

export class DevtoolsTargetService {
    async checkStatus(profile: ScraperProfile): Promise<DevtoolsStatus> {
        const localTunnelPort = profile.debugTunnelPort ?? profile.browserTargetPort;

        try {
            const resolved = await resolveChromeTargets(profile);
            const visibleTargets = filterVisibleTargets(resolved.targets);

            return {
                reachable: true,
                checkedAt: new Date(),
                debugHost: resolved.debugHost,
                debugPort: resolved.debugPort,
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
                debugHost: profile.assignedWorkerId,
                debugPort: profile.browserTargetPort,
                localTunnelPort,
                targetCount: 0,
                recommendedTargetId: null,
                error: message,
            };
        }
    }

    async listTargets(profile: ScraperProfile): Promise<DevtoolsTarget[]> {
        const resolved = await resolveChromeTargets(profile);
        const visibleTargets = filterVisibleTargets(resolved.targets);
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
