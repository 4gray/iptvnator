import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadMetadataPerson,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';
import type {
    DeepReadonly,
    DownloadOfflineDetail,
    DownloadOfflineSeason,
} from './download-offline-detail.viewmodel';

export type OfflineDetailItem = DeepReadonly<DownloadItem>;

export interface OfflineSelectedSeason {
    readonly identity: string;
    readonly key: string;
}

export function parseOfflineDownloadId(
    value: string | null
): number | undefined {
    const normalized = value?.trim() ?? '';
    if (!/^\d+$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function offlineDetailRepresentative(
    detail: DownloadOfflineDetail | undefined
): OfflineDetailItem | undefined {
    if (!detail) return undefined;
    return detail.kind === 'movie' ? detail.item : detail.representative;
}

export function offlineDetailIdentity(
    detail: DownloadOfflineDetail | undefined
): string | undefined {
    if (!detail) return undefined;
    const item = offlineDetailRepresentative(detail);
    if (!item) return undefined;
    return detail.kind === 'series'
        ? `series:${item.playlistId}:${item.seriesXtreamId ?? item.id}`
        : `movie:${item.playlistId}:${item.id}`;
}

export function offlineMetadataResolutionKey(
    detail: DownloadOfflineDetail | undefined,
    downloadId: number | undefined,
    language: string
): string | undefined {
    const item = offlineDetailRepresentative(detail);
    if (!detail || !item || downloadId === undefined) return undefined;
    const snapshot = detail.snapshot as DownloadMetadataSnapshot | undefined;
    return JSON.stringify([
        detail.kind,
        downloadId,
        item.id,
        item.playlistId,
        item.xtreamId,
        item.seriesXtreamId,
        item.seasonNumber,
        item.episodeNumber,
        item.title,
        item.posterUrl,
        language.trim() || 'en',
        snapshot,
    ]);
}

export function offlineSeasonKey(season: DownloadOfflineSeason): string {
    return season.seasonNumberState === 'known'
        ? `season-${season.seasonNumber}`
        : 'season-unknown';
}

export function offlineSeasonTestId(season: DownloadOfflineSeason): string {
    return `offline-${offlineSeasonKey(season)}`;
}

export function offlineEpisodeCount(
    season: DownloadOfflineSeason | undefined
): number {
    return season?.episodes.length ?? 0;
}

export function offlineEpisodeCoordinate(
    seasonNumber: number | null,
    episodeNumber: number | null
): string {
    const coordinate = (prefix: string, value: number | null) =>
        `${prefix}${value === null ? '??' : String(value).padStart(2, '0')}`;
    return `${coordinate('S', seasonNumber)}${coordinate('E', episodeNumber)}`;
}

export function offlineEpisodeTitle(
    item: OfflineDetailItem,
    metadataTitle?: string
): string {
    return metadataTitle?.trim() || item.title;
}

export function offlineFileByteCount(
    item: OfflineDetailItem
): number | undefined {
    return [item.totalBytes, item.bytesDownloaded].find(
        (value): value is number =>
            value !== undefined && Number.isFinite(value) && value > 0
    );
}

export function offlineDurationLabel(
    duration: number | undefined
): string | undefined {
    return duration !== undefined && Number.isFinite(duration) && duration > 0
        ? `${duration} min`
        : undefined;
}

export function offlinePositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

export function boundedOfflinePeople(
    values: readonly DownloadMetadataPerson[] | undefined
): readonly DownloadMetadataPerson[] {
    const people: DownloadMetadataPerson[] = [];
    const seenProviderIds = new Set<number>();
    const seenNames = new Set<string>();
    for (const person of values ?? []) {
        if (!person.name.trim()) continue;
        const nameKey = offlinePersonNameKey(person);
        const duplicate =
            seenNames.has(nameKey) ||
            (person.tmdbPersonId !== undefined &&
                seenProviderIds.has(person.tmdbPersonId));
        seenNames.add(nameKey);
        if (person.tmdbPersonId !== undefined) {
            seenProviderIds.add(person.tmdbPersonId);
        }
        if (duplicate) continue;
        people.push(person);
        if (people.length === 12) break;
    }
    return people;
}

export function offlinePersonTrackKey(person: DownloadMetadataPerson): string {
    return [person.tmdbPersonId ?? 'local', offlinePersonNameKey(person)].join(
        ':'
    );
}

function offlinePersonNameKey(person: DownloadMetadataPerson): string {
    return [
        person.name.trim().toLowerCase(),
        person.role?.trim().toLowerCase() ?? '',
    ].join(':');
}

export function offlineHasLocalFile(
    item: OfflineDetailItem | undefined
): boolean {
    return (
        item?.status === 'completed' &&
        !!item.filePath?.trim() &&
        item.fileAvailability !== 'missing'
    );
}

export function safeOfflineManagerReturnUrl(
    state: unknown,
    currentUrl: string
): string | undefined {
    if (!state || typeof state !== 'object') return undefined;
    const record = state as Record<string, unknown>;
    const returnUrl = record['returnUrl'];
    const navigationId = record['navigationId'];
    if (
        typeof returnUrl !== 'string' ||
        typeof navigationId !== 'number' ||
        navigationId <= 1 ||
        !returnUrl.startsWith('/') ||
        returnUrl.startsWith('//')
    ) {
        return undefined;
    }
    const currentPath = currentUrl.split(/[?#]/, 1)[0].replace(/\/$/, '');
    const managerPath = currentPath.replace(/\/[^/]+$/, '');
    const returnPath = returnUrl.split(/[?#]/, 1)[0].replace(/\/$/, '');
    const managerPattern =
        /^\/workspace\/(?:downloads|(?:xtreams|stalker)\/[^/?#]+\/downloads)$/;
    return managerPattern.test(managerPath) && returnPath === managerPath
        ? returnUrl
        : undefined;
}
