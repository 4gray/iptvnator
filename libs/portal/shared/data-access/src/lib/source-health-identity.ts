import {
    sourceHealthKey,
    type PlaylistMeta,
    type SourceHealthReason,
} from '@iptvnator/shared/interfaces';

const SOURCE_HEALTH_REASONS: ReadonlySet<string> = new Set<SourceHealthReason>([
    'available',
    'disabled',
    'expired',
    'auth',
    'http',
    'timeout',
    'network',
    'paused',
    'invalid',
    'unknown',
    'cancelled',
]);

/** Whether stored data names a reason this build can describe. */
export function isSourceHealthReason(
    value: unknown
): value is SourceHealthReason {
    return typeof value === 'string' && SOURCE_HEALTH_REASONS.has(value);
}

/**
 * A 32-bit FNV-1a fingerprint of a source health key: enough to tell that a
 * source now points somewhere else, without storing where (or with which
 * credentials). Kept with the persisted health history.
 */
export function fingerprintSourceHealthKey(key: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < key.length; index += 1) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sourceHealthFingerprint(p: Partial<PlaylistMeta>): string {
    return fingerprintSourceHealthKey(sourceHealthKey(p));
}
