import type { PlaylistMeta } from './playlist-meta.type';

export type SourceHealthState =
    'unknown' | 'checking' | 'active' | 'inactive' | 'expired' | 'unavailable';
export type SourceHealthReason =
    | 'available'
    | 'disabled'
    | 'expired'
    | 'auth'
    | 'http'
    | 'timeout'
    | 'network'
    | 'paused'
    | 'invalid'
    | 'unknown'
    | 'cancelled';
export interface SourceHealthResult {
    state: SourceHealthState;
    reason: SourceHealthReason;
    expiresAtSeconds?: number;
    httpStatus?: number;
    confirmedInactive: boolean;
}
export interface SourceHealthSnapshot extends SourceHealthResult {
    checkedAt: number;
    lastSuccessAt?: number;
}
export interface SourceProbeContext {
    requestId: string;
    deadlineAt: number;
}
export const SOURCE_HEALTH_CANCEL = 'SOURCE_HEALTH_CANCEL';
export const M3U_SOURCE_PROBE = 'M3U_SOURCE_PROBE';
export function sourceHealthUnknown(
    reason: SourceHealthReason = 'unknown'
): SourceHealthResult {
    return { state: 'unavailable', reason, confirmedInactive: false };
}
export function sourceHealthType(
    p: Partial<PlaylistMeta>
): 'stalker' | 'xtream' | 'm3u' | null {
    if (p.macAddress && p.portalUrl) return 'stalker';
    if (p.serverUrl && p.username && p.password) return 'xtream';
    return p.url && /^https?:\/\//i.test(p.url) ? 'm3u' : null;
}
export function sourceHealthKey(p: Partial<PlaylistMeta>): string {
    return JSON.stringify([
        sourceHealthType(p),
        p.url,
        p.serverUrl,
        p.portalUrl,
        p.username,
        p.password,
        p.macAddress,
        p.userAgent,
        p.isFullStalkerPortal,
        p.stalkerSerialNumber,
        p.stalkerDeviceId1,
        p.stalkerDeviceId2,
        p.stalkerSignature1,
        p.stalkerSignature2,
    ]);
}
export function accountHealth(
    status: unknown,
    expiration?: number,
    authenticated = false
): SourceHealthResult {
    const value = String(status ?? '')
        .trim()
        .toLowerCase();
    if (value === 'expired' || (expiration && expiration * 1000 < Date.now())) {
        return {
            state: 'expired',
            reason: 'expired',
            confirmedInactive: true,
            expiresAtSeconds: expiration,
        };
    }
    if (['disabled', 'banned', 'inactive'].includes(value)) {
        return {
            state: 'inactive',
            reason: 'disabled',
            confirmedInactive: true,
            expiresAtSeconds: expiration,
        };
    }
    if (value === 'active' || authenticated) {
        return {
            state: 'active',
            reason: 'available',
            confirmedInactive: false,
            expiresAtSeconds: expiration,
        };
    }
    return sourceHealthUnknown();
}
export function sourceHealthError(error: unknown): SourceHealthResult {
    const text = error instanceof Error ? error.message : String(error);
    if (/abort|cancel/i.test(text)) return sourceHealthUnknown('cancelled');
    if (/guard|cooldown|paused|circuit/i.test(text))
        return sourceHealthUnknown('paused');
    if (/timeout|timed out|deadline/i.test(text))
        return sourceHealthUnknown('timeout');
    if (
        /authoriz|auth.failed|access.denied/i.test(text) ||
        (text.toLowerCase().includes('http error') &&
            (text.includes('401') || text.includes('403')))
    )
        return { ...sourceHealthUnknown('auth'), state: 'inactive' };
    if (/HTTP Error/i.test(text)) return sourceHealthUnknown('http');
    return sourceHealthUnknown('network');
}
