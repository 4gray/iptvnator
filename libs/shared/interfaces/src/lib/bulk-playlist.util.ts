import { createRandomId } from './random-id.util';
import {
    ProviderImportCandidate,
    ProviderImportKind,
} from './provider-import-detection.util';
import { extractXtreamCredentialsFromUrl } from './xtream-portal.utils';
import { Playlist } from './playlist.interface';
import {
    normalizeImportScope,
    storedImportScopeFlags,
} from './playlist-import-scope.util';

/**
 * One row of a bulk import: a detected source plus its section scope.
 * `id` is a client-side row key (not the playlist id); `valid` tells the
 * preview whether the row carries enough data to import.
 */
export interface BulkImportEntry {
    id: string;
    kind: ProviderImportKind;
    title: string;
    importLive: boolean;
    importVod: boolean;
    valid: boolean;
    candidate: ProviderImportCandidate;
}

/** Portal rows import directly; M3U rows need a fetch/parse step first. */
export function isDirectBulkPlaylistEntry(entry: BulkImportEntry): boolean {
    return entry.kind === 'xtream' || entry.kind === 'stalker';
}

/**
 * Row defaults: live imports, VOD does not. Bulk imports usually carry
 * many provider handouts whose on-demand catalogs plug the queue with
 * thousands of movies and series per source, so VOD stays a per-row
 * opt-in; a structured file can still request it with `importVod: true`.
 */
export function createBulkImportScopeDefaults(): {
    importLive: boolean;
    importVod: boolean;
} {
    return {
        importLive: true,
        importVod: false,
    };
}

export function candidatesToBulkEntries(
    candidates: readonly ProviderImportCandidate[]
): BulkImportEntry[] {
    return candidates.map((candidate, index) => ({
        id: createRandomId(),
        kind: candidate.kind,
        title: candidate.suggestedTitle?.trim() || `Source ${index + 1}`,
        ...createBulkImportScopeDefaults(),
        valid: isImportableCandidate(candidate),
        candidate,
    }));
}

export function isImportableCandidate(
    candidate: ProviderImportCandidate
): boolean {
    switch (candidate.kind) {
        case 'xtream':
            return Boolean(
                candidate.serverUrl && candidate.username && candidate.password
            );
        case 'stalker':
            return Boolean(candidate.portalUrl && candidate.macAddress);
        case 'm3u-url':
            return Boolean(candidate.url);
        case 'm3u-text':
            return Boolean(candidate.text?.trim());
    }
}

/**
 * Why a preview row cannot be imported. An unusable row stays in the list (the
 * user must still see what the file contained and be able to remove it), so
 * the dialog names the gap instead of only graying the row out.
 */
export type BulkImportIssue = 'no-portal' | 'no-mac' | 'missing-details';

/** Null for an importable row; the first reason it cannot be imported otherwise. */
export function bulkEntryIssue(entry: BulkImportEntry): BulkImportIssue | null {
    if (entry.valid) {
        return null;
    }
    const { candidate } = entry;
    if (candidate.kind !== 'stalker') {
        return 'missing-details';
    }
    return candidate.portalUrl ? 'no-mac' : 'no-portal';
}

/**
 * One detected link must become ONE bulk row. Detection offers a `get.php`
 * link both as an Xtream portal (ranked high) and as a plain M3U fallback
 * (ranked low) — the single-add flow lets the user pick one, but a bulk file
 * has no picker, so keeping both would import the same account twice: the
 * Xtream portal AND a full m3u_plus download per source. The parallel
 * fetch/parse of those duplicate downloads saturates the renderer mid-import
 * and freezes the app halfway through a file of provider links.
 *
 * The M3U fallback is only a real second source when its URL carries
 * DIFFERENT credentials than an already-detected Xtream portal (a reseller
 * handing out both the portal API and a plain download link for another
 * account). Same credentials → the fallback is the same source, drop it.
 */
export function dedupeBulkCandidates(
    candidates: readonly ProviderImportCandidate[]
): ProviderImportCandidate[] {
    const xtreamKeys = new Set(
        candidates
            .filter((candidate) => candidate.kind === 'xtream')
            .map((candidate) =>
                [
                    serverKey(candidate.serverUrl),
                    candidate.username,
                    candidate.password,
                ].join('\u0000')
            )
    );
    return candidates.filter((candidate) => {
        if (candidate.kind !== 'm3u-url' || !candidate.url) {
            return true;
        }
        const credentials = extractXtreamCredentialsFromUrl(candidate.url);
        if (!credentials?.username || !credentials?.password) {
            return true;
        }
        const key = [
            serverKey(candidate.url),
            credentials.username,
            credentials.password,
        ].join('\u0000');
        return !xtreamKeys.has(key);
    });
}

/** Same host and port: the same account on another server is another source. */
function serverKey(value: string | null | undefined): string {
    const raw = value?.trim();
    if (!raw) {
        return '';
    }
    try {
        return new URL(raw).origin.toLowerCase();
    } catch {
        return raw.replace(/\/+$/, '').toLowerCase();
    }
}

/**
 * Structured bulk file shape: an explicit source list that needs no
 * detection. Accepts `{ "sources": [...] }` or a bare array. Every item
 * needs a `type` plus the connection fields of that type; `title`,
 * `importLive` and `importVod` are optional, and unspecified sections take
 * the row defaults (live on, VOD off).
 */
export interface BulkFileXtreamSource {
    type: 'xtream';
    title?: string;
    serverUrl: string;
    username: string;
    password?: string;
    importLive?: boolean;
    importVod?: boolean;
}

export interface BulkFileStalkerSource {
    type: 'stalker';
    title?: string;
    portalUrl: string;
    macAddress: string;
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
    username?: string;
    password?: string;
    importLive?: boolean;
    importVod?: boolean;
}

export interface BulkFileM3uUrlSource {
    type: 'm3u-url';
    title?: string;
    url: string;
    userAgent?: string;
    importLive?: boolean;
    importVod?: boolean;
}

export type BulkFileSource =
    BulkFileXtreamSource | BulkFileStalkerSource | BulkFileM3uUrlSource;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalScopeFlag(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/**
 * Converts parsed JSON into bulk rows, or null when it is not a bulk file.
 * Unknown items are skipped (not fatal): the preview shows what imported.
 */
export function bulkEntriesFromJson(value: unknown): BulkImportEntry[] | null {
    const items = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value['sources'])
          ? (value['sources'] as unknown[])
          : null;
    if (!items) {
        return null;
    }
    const entries: BulkImportEntry[] = [];
    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }
        const title =
            asOptionalString(item['title']) ?? `Source ${entries.length + 1}`;
        const scope = {
            importLive: asOptionalScopeFlag(item['importLive']) ?? true,
            importVod: asOptionalScopeFlag(item['importVod']) ?? false,
        };
        if (item['type'] === 'xtream') {
            const candidate: ProviderImportCandidate = {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: asOptionalString(item['serverUrl']),
                username: asOptionalString(item['username']),
                password: asOptionalString(item['password']),
                suggestedTitle: title,
            };
            entries.push({
                id: createRandomId(),
                kind: 'xtream',
                title,
                ...scope,
                valid: isImportableCandidate(candidate),
                candidate,
            });
        } else if (item['type'] === 'stalker') {
            const candidate: ProviderImportCandidate = {
                kind: 'stalker',
                confidence: 'high',
                portalUrl: asOptionalString(item['portalUrl']),
                macAddress: asOptionalString(item['macAddress']),
                serialNumber: asOptionalString(item['serialNumber']),
                deviceId1: asOptionalString(item['deviceId1']),
                deviceId2: asOptionalString(item['deviceId2']),
                signature1: asOptionalString(item['signature1']),
                signature2: asOptionalString(item['signature2']),
                username: asOptionalString(item['username']),
                password: asOptionalString(item['password']),
                suggestedTitle: title,
            };
            entries.push({
                id: createRandomId(),
                kind: 'stalker',
                title,
                ...scope,
                valid: isImportableCandidate(candidate),
                candidate,
            });
        } else if (item['type'] === 'm3u-url' || item['type'] === 'm3u') {
            const candidate: ProviderImportCandidate = {
                kind: 'm3u-url',
                confidence: 'high',
                url: asOptionalString(item['url']),
                suggestedTitle: title,
            };
            entries.push({
                id: createRandomId(),
                kind: 'm3u-url',
                title,
                ...scope,
                valid: isImportableCandidate(candidate),
                candidate,
            });
        }
    }
    return entries;
}

/**
 * Builds a persistable playlist for a portal row. M3U rows return null —
 * the caller fetches/parses those through the regular M3U pipeline with
 * the row's scope instead.
 */
export function bulkEntryToPlaylist(entry: BulkImportEntry): Playlist | null {
    const { importLive, importVod } = normalizeImportScope(entry);
    const scope = storedImportScopeFlags({ importLive, importVod });
    switch (entry.kind) {
        case 'xtream': {
            const { candidate } = entry;
            if (
                !candidate.serverUrl ||
                !candidate.username ||
                !candidate.password
            ) {
                return null;
            }
            return {
                _id: createRandomId(),
                title: entry.title,
                serverUrl: candidate.serverUrl,
                username: candidate.username,
                password: candidate.password,
                importDate: new Date().toISOString(),
                ...scope,
            } as Playlist;
        }
        case 'stalker': {
            const { candidate } = entry;
            if (!candidate.portalUrl || !candidate.macAddress) {
                return null;
            }
            return {
                _id: createRandomId(),
                title: entry.title,
                portalUrl: candidate.portalUrl,
                macAddress: candidate.macAddress,
                ...(candidate.serialNumber
                    ? { stalkerSerialNumber: candidate.serialNumber }
                    : {}),
                ...(candidate.deviceId1
                    ? { stalkerDeviceId1: candidate.deviceId1 }
                    : {}),
                ...(candidate.deviceId2
                    ? { stalkerDeviceId2: candidate.deviceId2 }
                    : {}),
                ...(candidate.signature1
                    ? { stalkerSignature1: candidate.signature1 }
                    : {}),
                ...(candidate.signature2
                    ? { stalkerSignature2: candidate.signature2 }
                    : {}),
                ...(candidate.username ? { username: candidate.username } : {}),
                ...(candidate.password ? { password: candidate.password } : {}),
                importDate: new Date().toISOString(),
                ...scope,
            } as Playlist;
        }
        default:
            return null;
    }
}
