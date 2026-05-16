import { app, BrowserWindow } from 'electron';
import axios from 'axios';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import * as schema from 'database-schema';
import type {
    BackgroundMetadataWarmupSchedule,
    MediaStreamMetadata,
    SourceVpnRequestContext,
} from 'shared-interfaces';
import { getBackgroundMetadataFreshnessCutoff } from 'shared-interfaces';
import { initDatabase } from '../database/connection';
import { setContentMediaMetadata } from '../database/operations/content.operations';
import {
    getEpisodeMediaMetadataForSeries,
    setEpisodeMediaMetadata,
} from '../database/operations/episode-media-metadata.operations';
import {
    clearMediaMetadataJobs,
    deleteMediaMetadataJob,
    deleteMediaMetadataSeriesDiscoveryJob,
    getPendingMediaMetadataJobs,
    getPendingMediaMetadataSeriesDiscoveryJobs,
    upsertMediaMetadataJobs,
    upsertMediaMetadataSeriesDiscoveryJobs,
    type PersistedMediaMetadataJob,
    type PersistedMediaMetadataSeriesDiscoveryJob,
} from '../database/operations/media-metadata-job.operations';
import {
    getAppPlaylists,
    setAppState,
} from '../database/operations/playlist.operations';
import { probeMediaStreamMetadata } from './media-stream-metadata.service';
import {
    ensureSourceNetworkReady,
    getSourceAxiosAgents,
} from './source-network-options';

const DEFAULT_CONCURRENT_BACKGROUND_PROBES = 2;
const MAX_CONCURRENT_BACKGROUND_PROBES = 8;
const MAX_CONCURRENT_SERIES_DISCOVERY = 4;
const MAX_INTERACTIVE_BACKGROUND_PROBES = 1;
const MAX_INTERACTIVE_SERIES_DISCOVERY = 1;
const STATUS_BROADCAST_MIN_INTERVAL_MS = 1000;
const INTERACTIVE_PROBE_START_INTERVAL_MS = 3000;
const INTERACTIVE_SERIES_DISCOVERY_START_INTERVAL_MS = 3000;
const SERIES_DISCOVERY_TIMEOUT_MS = 20000;
const BACKGROUND_METADATA_LAST_RUN_KEY_PREFIX =
    'xtream-background-metadata-warmup:last-run';
export const MEDIA_METADATA_BACKGROUND_EVENT =
    'MEDIA_METADATA_BACKGROUND_EVENT';

export interface MediaMetadataBackgroundWarmJob {
    playlistId: string;
    contentType: 'live' | 'movie' | 'episode';
    xtreamId: number;
    seriesXtreamId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    url: string;
    headers?: Record<string, string>;
    staticMetadata?: MediaStreamMetadata | null;
    sourceVpn?: SourceVpnRequestContext;
}

export interface MediaMetadataBackgroundSeriesDiscoveryJob {
    playlistId: string;
    serverUrl: string;
    username: string;
    password: string;
    seriesXtreamId: number;
    headers?: Record<string, string>;
    sourceVpn?: SourceVpnRequestContext;
}

interface SeriesEpisodeDescriptor {
    episode: Record<string, unknown>;
    seasonKey?: string;
}

export interface MediaMetadataBackgroundStartPayload {
    jobs: MediaMetadataBackgroundWarmJob[];
    seriesDiscoveryJobs?: MediaMetadataBackgroundSeriesDiscoveryJob[];
    runAfterWindowClose: boolean;
    concurrency?: number;
}

export interface MediaMetadataBackgroundStatus {
    allowRunAfterWindowClose: boolean;
    averageProbeMs?: number;
    completedAt?: number;
    failedItems: number;
    itemsPerMinute?: number;
    lastProbeMs?: number;
    lastError?: string;
    pendingItems: number;
    processedItems: number;
    running: boolean;
    startedAt?: number;
    totalItems: number;
}

export type MediaMetadataBackgroundEvent =
    | {
          type: 'status';
          status: MediaMetadataBackgroundStatus;
      }
    | {
          type: 'item';
          playlistId: string;
          contentType: 'live' | 'movie' | 'series' | 'episode';
          xtreamId: number;
          metadata: MediaStreamMetadata;
          status: MediaMetadataBackgroundStatus;
      };

function unavailable(reason: string): MediaStreamMetadata {
    return {
        available: false,
        audioLanguages: [],
        audioCodecs: [],
        subtitleLanguages: [],
        subtitleCodecs: [],
        reason,
    };
}

function unique(values: readonly string[] | undefined): string[] {
    return [
        ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
    ];
}

function uniqueNumbers(values: readonly (number | undefined)[]): number[] {
    return [
        ...new Set(
            values.filter(
                (value): value is number =>
                    typeof value === 'number' && Number.isFinite(value)
            )
        ),
    ];
}

function collectQualityLabels(
    metadata: MediaStreamMetadata | null | undefined
): string[] {
    return unique([
        ...(metadata?.qualityLabels ?? []),
        metadata?.qualityLabel ?? '',
    ]);
}

function collectHeights(
    metadata: MediaStreamMetadata | null | undefined
): number[] {
    return uniqueNumbers([...(metadata?.heights ?? []), metadata?.height]);
}

function collectWidths(
    metadata: MediaStreamMetadata | null | undefined
): number[] {
    return uniqueNumbers([...(metadata?.widths ?? []), metadata?.width]);
}

function collectVideoCodecs(
    metadata: MediaStreamMetadata | null | undefined
): string[] {
    return unique([
        ...(metadata?.videoCodecs ?? []),
        metadata?.videoCodec ?? '',
    ]);
}

function mergeMetadata(
    primary: MediaStreamMetadata,
    fallback?: MediaStreamMetadata | null
): MediaStreamMetadata {
    if (!fallback) {
        return primary;
    }

    return {
        available: primary.available || fallback.available,
        qualityLabel: primary.qualityLabel ?? fallback.qualityLabel,
        qualityLabels: unique([
            ...collectQualityLabels(primary),
            ...collectQualityLabels(fallback),
        ]),
        width: primary.width ?? fallback.width,
        widths: uniqueNumbers([
            ...collectWidths(primary),
            ...collectWidths(fallback),
        ]),
        height: primary.height ?? fallback.height,
        heights: uniqueNumbers([
            ...collectHeights(primary),
            ...collectHeights(fallback),
        ]),
        videoCodec: primary.videoCodec ?? fallback.videoCodec,
        videoCodecs: unique([
            ...collectVideoCodecs(primary),
            ...collectVideoCodecs(fallback),
        ]),
        audioLanguages: unique([
            ...(primary.audioLanguages ?? []),
            ...(fallback.audioLanguages ?? []),
        ]),
        audioCodecs: unique([
            ...(primary.audioCodecs ?? []),
            ...(fallback.audioCodecs ?? []),
        ]),
        subtitleLanguages: unique([
            ...(primary.subtitleLanguages ?? []),
            ...(fallback.subtitleLanguages ?? []),
        ]),
        subtitleCodecs: unique([
            ...(primary.subtitleCodecs ?? []),
            ...(fallback.subtitleCodecs ?? []),
        ]),
        source: primary.source ?? fallback.source,
        reason: primary.reason ?? fallback.reason,
    };
}

function metadataNeedsProbe(
    metadata: MediaStreamMetadata | null | undefined
): boolean {
    return (
        !metadata ||
        (!metadata.qualityLabel &&
            (metadata.qualityLabels ?? []).length === 0) ||
        (metadata.audioLanguages ?? []).length === 0 ||
        (metadata.subtitleLanguages ?? []).length === 0
    );
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPositiveNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function readFirstString(...values: unknown[]): string | null {
    for (const value of values) {
        const text = readString(value);
        if (text) {
            return text;
        }
    }

    return null;
}

function stringifyLoose(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        return '';
    }
}

function inferDimensionsFromText(text: string): {
    width?: number;
    height: number;
} | null {
    const normalized = text.toLowerCase();
    const explicit = normalized.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
    if (explicit) {
        const width = Number(explicit[1]);
        const height = Number(explicit[2]);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            return { width, height };
        }
    }

    const heightMatch = normalized.match(
        /\b(2160|1440|1080|720|576|540|480|360|240)\s*p\b/
    );
    if (!heightMatch) {
        return null;
    }

    const height = Number(heightMatch[1]);
    const widthByHeight: Record<number, number> = {
        2160: 3840,
        1440: 2560,
        1080: 1920,
        720: 1280,
        576: 1024,
        540: 960,
        480: 854,
        360: 640,
        240: 426,
    };
    return { width: widthByHeight[height], height };
}

function inferVideoCodecFromText(text: string): string | undefined {
    const normalized = text.toLowerCase();
    if (/\b(hevc|h\.?265|x265)\b/.test(normalized)) {
        return 'HEVC';
    }
    if (/\b(avc|h\.?264|x264)\b/.test(normalized)) {
        return 'H.264';
    }
    if (/\bav1\b/.test(normalized)) {
        return 'AV1';
    }
    if (/\bvp9\b/.test(normalized)) {
        return 'VP9';
    }

    return undefined;
}

function inferLanguagesFromText(text: string): string[] {
    const normalized = ` ${text.toLowerCase()} `;
    const aliases: Array<[RegExp, string]> = [
        [/\b(ita|it|italian|italiano)\b/, 'ITA'],
        [/\b(eng|en|english|inglese)\b/, 'ENG'],
        [/\b(fra|fre|fr|french|francais)\b/, 'FRA'],
        [/\b(deu|ger|de|german|tedesco)\b/, 'DEU'],
        [/\b(spa|es|spanish|espanol)\b/, 'SPA'],
        [/\b(por|pt|portuguese)\b/, 'POR'],
        [/\b(pol|pl|polish)\b/, 'POL'],
        [/\b(rus|ru|russian)\b/, 'RUS'],
    ];

    return unique(
        aliases
            .filter(([pattern]) => pattern.test(normalized))
            .map(([, code]) => code)
    );
}

function buildEpisodeStaticMetadata(
    episode: Record<string, unknown>
): MediaStreamMetadata | null {
    const info = readRecord(episode['info']);
    const movieData = readRecord(episode['movie_data']);
    const video = stringifyLoose(
        episode['video'] ?? info?.['video'] ?? movieData?.['video']
    );
    const audio = stringifyLoose(
        episode['audio'] ??
            episode['audioLanguages'] ??
            info?.['audio'] ??
            info?.['audioLanguages'] ??
            movieData?.['audio']
    );
    const subtitles = stringifyLoose(
        episode['subtitles'] ??
            episode['subtitle'] ??
            episode['subtitleLanguages'] ??
            info?.['subtitles'] ??
            info?.['subtitle'] ??
            info?.['subtitleLanguages'] ??
            movieData?.['subtitles'] ??
            movieData?.['subtitle']
    );
    const title = [
        episode['title'],
        episode['name'],
        info?.['name'],
        movieData?.['name'],
        episode['container_extension'],
    ]
        .map((value) => stringifyLoose(value))
        .join(' ');
    const dimensions = inferDimensionsFromText(`${video} ${title}`);
    const videoCodec = inferVideoCodecFromText(`${video} ${title}`);
    const qualityLabel = dimensions
        ? `${dimensions.height}p${videoCodec ? ` ${videoCodec}` : ''}`
        : undefined;
    const audioLanguages = inferLanguagesFromText(audio);
    const subtitleLanguages = inferLanguagesFromText(subtitles);

    if (
        !qualityLabel &&
        audioLanguages.length === 0 &&
        subtitleLanguages.length === 0
    ) {
        return null;
    }

    return {
        available: true,
        qualityLabel,
        qualityLabels: qualityLabel ? [qualityLabel] : [],
        width: dimensions?.width,
        widths: dimensions?.width ? [dimensions.width] : [],
        height: dimensions?.height,
        heights: dimensions?.height ? [dimensions.height] : [],
        videoCodec,
        videoCodecs: videoCodec ? [videoCodec] : [],
        audioLanguages,
        audioCodecs: [],
        subtitleLanguages,
        subtitleCodecs: [],
        source: 'xtream',
    };
}

export function extractSeriesEpisodeDescriptors(payload: {
    episodes?: unknown;
}): SeriesEpisodeDescriptor[] {
    const episodes = payload.episodes;
    if (Array.isArray(episodes)) {
        return episodes
            .map((episode) => readRecord(episode))
            .filter(
                (episode): episode is Record<string, unknown> =>
                    episode !== null
            )
            .map((episode) => ({ episode }));
    }

    const episodesBySeason = readRecord(episodes);
    if (!episodesBySeason) {
        return [];
    }

    const descriptors: SeriesEpisodeDescriptor[] = [];
    for (const [seasonKey, seasonValue] of Object.entries(episodesBySeason)) {
        if (Array.isArray(seasonValue)) {
            for (const episode of seasonValue) {
                const record = readRecord(episode);
                if (record) {
                    descriptors.push({ episode: record, seasonKey });
                }
            }
            continue;
        }

        const record = readRecord(seasonValue);
        if (!record) {
            continue;
        }

        if (
            readPositiveNumber(
                record['id'] ??
                    record['episode_id'] ??
                    record['episodeId'] ??
                    record['stream_id']
            )
        ) {
            descriptors.push({ episode: record, seasonKey });
            continue;
        }

        for (const nestedValue of Object.values(record)) {
            const nestedEpisodes = Array.isArray(nestedValue)
                ? nestedValue
                : [nestedValue];
            for (const nestedEpisode of nestedEpisodes) {
                const nestedRecord = readRecord(nestedEpisode);
                if (nestedRecord) {
                    descriptors.push({ episode: nestedRecord, seasonKey });
                }
            }
        }
    }

    return descriptors;
}

function createJobKey(job: MediaMetadataBackgroundWarmJob): string {
    return JSON.stringify({
        playlistId: job.playlistId,
        contentType: job.contentType,
        xtreamId: job.xtreamId,
        seriesXtreamId: job.seriesXtreamId ?? null,
        seasonNumber: job.seasonNumber ?? null,
        episodeNumber: job.episodeNumber ?? null,
        url: job.url,
        headers: job.headers ?? {},
    });
}

function createSeriesDiscoveryKey(
    job: MediaMetadataBackgroundSeriesDiscoveryJob
): string {
    return JSON.stringify({
        playlistId: job.playlistId,
        seriesXtreamId: job.seriesXtreamId,
    });
}

function normalizeJobSourceVpn(
    sourceVpn: SourceVpnRequestContext | undefined
): SourceVpnRequestContext | undefined {
    if (sourceVpn?.provider !== 'proton') {
        return undefined;
    }

    const location =
        typeof sourceVpn.location === 'string' && sourceVpn.location.trim()
            ? sourceVpn.location.trim().toUpperCase()
            : undefined;

    return {
        provider: 'proton',
        ...(location ? { location } : {}),
        ...(sourceVpn.sourceId ? { sourceId: sourceVpn.sourceId } : {}),
        ...(sourceVpn.sourceTitle
            ? { sourceTitle: sourceVpn.sourceTitle }
            : {}),
    };
}

function getJobNetworkKey(
    sourceVpn: SourceVpnRequestContext | undefined
): string {
    const normalized = normalizeJobSourceVpn(sourceVpn);
    if (!normalized) {
        return 'global';
    }

    return ['source', normalized.provider, normalized.location ?? ''].join(':');
}

export function normalizeMetadataWarmupConcurrency(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_CONCURRENT_BACKGROUND_PROBES;
    }

    return Math.max(
        1,
        Math.min(MAX_CONCURRENT_BACKGROUND_PROBES, Math.floor(numeric))
    );
}

export function aggregateSeriesEpisodeMetadata(
    episodeMetadata: readonly MediaStreamMetadata[]
): MediaStreamMetadata | null {
    if (episodeMetadata.length === 0) {
        return null;
    }

    const qualityLabels = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [
                ...values,
                ...collectQualityLabels(metadata),
            ],
            []
        )
    );
    const heights = uniqueNumbers(
        episodeMetadata.reduce<number[]>(
            (values, metadata) => [...values, ...collectHeights(metadata)],
            []
        )
    );
    const widths = uniqueNumbers(
        episodeMetadata.reduce<number[]>(
            (values, metadata) => [...values, ...collectWidths(metadata)],
            []
        )
    );
    const videoCodecs = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [...values, ...collectVideoCodecs(metadata)],
            []
        )
    );
    const audioLanguages = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [
                ...values,
                ...(metadata.audioLanguages ?? []),
            ],
            []
        )
    );
    const audioCodecs = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [...values, ...(metadata.audioCodecs ?? [])],
            []
        )
    );
    const subtitleLanguages = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [
                ...values,
                ...(metadata.subtitleLanguages ?? []),
            ],
            []
        )
    );
    const subtitleCodecs = unique(
        episodeMetadata.reduce<string[]>(
            (values, metadata) => [
                ...values,
                ...(metadata.subtitleCodecs ?? []),
            ],
            []
        )
    );

    return {
        available: episodeMetadata.some((metadata) => metadata.available),
        qualityLabel: qualityLabels.length === 1 ? qualityLabels[0] : undefined,
        qualityLabels,
        width: widths.length === 1 ? widths[0] : undefined,
        widths,
        height: heights.length === 1 ? heights[0] : undefined,
        heights,
        videoCodec: videoCodecs.length === 1 ? videoCodecs[0] : undefined,
        videoCodecs,
        audioLanguages,
        audioCodecs,
        subtitleLanguages,
        subtitleCodecs,
        source: 'derived',
        reason:
            episodeMetadata.find((metadata) => metadata.reason)?.reason ??
            undefined,
    };
}

class MediaMetadataBackgroundWarmupService {
    private activeProbes = 0;
    private activeSeriesDiscoveries = 0;
    private activeNetworkKey: string | null = null;
    private currentRunId = 0;
    private readonly knownJobKeys = new Set<string>();
    private readonly knownSeriesDiscoveryKeys = new Set<string>();
    private readonly queue: MediaMetadataBackgroundWarmJob[] = [];
    private readonly seriesDiscoveryQueue: MediaMetadataBackgroundSeriesDiscoveryJob[] =
        [];
    private maxConcurrentProbes = DEFAULT_CONCURRENT_BACKGROUND_PROBES;
    private lastStatusBroadcastAt = 0;
    private lastInteractiveProbeStartedAt = 0;
    private lastInteractiveSeriesDiscoveryStartedAt = 0;
    private interactiveProbeTimer: ReturnType<typeof setTimeout> | null = null;
    private interactiveSeriesDiscoveryTimer: ReturnType<
        typeof setTimeout
    > | null = null;
    private status: MediaMetadataBackgroundStatus = {
        allowRunAfterWindowClose: false,
        failedItems: 0,
        pendingItems: 0,
        processedItems: 0,
        running: false,
        totalItems: 0,
    };

    async start(
        payload: MediaMetadataBackgroundStartPayload
    ): Promise<MediaMetadataBackgroundStatus> {
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        const seriesDiscoveryJobs = Array.isArray(payload?.seriesDiscoveryJobs)
            ? payload.seriesDiscoveryJobs
            : [];
        const runAfterWindowClose = Boolean(payload?.runAfterWindowClose);
        this.maxConcurrentProbes = normalizeMetadataWarmupConcurrency(
            payload?.concurrency
        );
        const addedJobsForPersistence: MediaMetadataBackgroundWarmJob[] = [];
        const addedSeriesDiscoveryJobsForPersistence: MediaMetadataBackgroundSeriesDiscoveryJob[] =
            [];

        if (!this.status.running && this.activeProbes === 0) {
            this.currentRunId++;
            this.knownJobKeys.clear();
            this.knownSeriesDiscoveryKeys.clear();
            this.queue.length = 0;
            this.seriesDiscoveryQueue.length = 0;
            this.activeNetworkKey = null;
            this.status = {
                allowRunAfterWindowClose: runAfterWindowClose,
                failedItems: 0,
                pendingItems: 0,
                processedItems: 0,
                running: jobs.length > 0,
                startedAt: jobs.length > 0 ? Date.now() : undefined,
                totalItems: 0,
            };
        } else {
            this.status = {
                ...this.status,
                allowRunAfterWindowClose:
                    this.status.allowRunAfterWindowClose || runAfterWindowClose,
            };
        }

        let addedJobs = 0;
        for (const job of jobs) {
            if (!this.isValidJob(job)) {
                continue;
            }

            const key = createJobKey(job);
            if (this.knownJobKeys.has(key)) {
                continue;
            }

            const normalizedJob = {
                ...job,
                sourceVpn: normalizeJobSourceVpn(job.sourceVpn),
            };
            this.knownJobKeys.add(key);
            this.queue.push(normalizedJob);
            addedJobsForPersistence.push(normalizedJob);
            addedJobs++;
        }

        let addedSeriesDiscoveryJobs = 0;
        for (const job of seriesDiscoveryJobs) {
            if (!this.isValidSeriesDiscoveryJob(job)) {
                continue;
            }

            const key = createSeriesDiscoveryKey(job);
            if (this.knownSeriesDiscoveryKeys.has(key)) {
                continue;
            }

            this.knownSeriesDiscoveryKeys.add(key);
            const normalizedJob = {
                ...job,
                serverUrl: job.serverUrl.replace(/\/+$/, ''),
                sourceVpn: normalizeJobSourceVpn(job.sourceVpn),
            };
            this.seriesDiscoveryQueue.push(normalizedJob);
            addedSeriesDiscoveryJobsForPersistence.push(normalizedJob);
            addedSeriesDiscoveryJobs++;
        }

        const addedWorkItems = addedJobs + addedSeriesDiscoveryJobs;
        if (addedWorkItems > 0) {
            this.status = {
                ...this.status,
                completedAt: undefined,
                pendingItems:
                    this.queue.length + this.seriesDiscoveryQueue.length,
                running: true,
                startedAt: this.status.startedAt ?? Date.now(),
                totalItems: this.status.totalItems + addedWorkItems,
            };
            this.broadcastStatus(true);
            if (this.status.allowRunAfterWindowClose || runAfterWindowClose) {
                void this.persistJobs(
                    addedJobsForPersistence,
                    addedSeriesDiscoveryJobsForPersistence,
                    true
                )
                    .catch((error) => {
                        console.warn(
                            'Failed to persist background media metadata jobs:',
                            error
                        );
                    })
                    .finally(() => this.drainQueuesWhenAllowed());
            } else {
                this.drainQueuesWhenAllowed();
            }
        } else {
            this.refreshPendingStatus();
            this.broadcastStatus(true);
            this.finishIfComplete();
        }

        return this.getStatus();
    }

    async cancel(): Promise<MediaMetadataBackgroundStatus> {
        this.currentRunId++;
        this.queue.length = 0;
        this.seriesDiscoveryQueue.length = 0;
        this.knownJobKeys.clear();
        this.knownSeriesDiscoveryKeys.clear();
        this.activeNetworkKey = null;
        this.clearInteractiveDrainTimers();
        await initDatabase()
            .then((db) => clearMediaMetadataJobs(db))
            .catch(() => undefined);
        this.status = {
            ...this.status,
            allowRunAfterWindowClose: false,
            completedAt: Date.now(),
            pendingItems: 0,
            running: false,
        };
        this.clearInteractiveDrainTimers();
        this.broadcastStatus(true);
        return this.getStatus();
    }

    async resumePendingJobs(): Promise<MediaMetadataBackgroundStatus> {
        const db = await initDatabase();
        const persistedJobs = await getPendingMediaMetadataJobs(db);
        const persistedSeriesDiscoveryJobs =
            await getPendingMediaMetadataSeriesDiscoveryJobs(db);
        if (
            persistedJobs.length === 0 &&
            persistedSeriesDiscoveryJobs.length === 0
        ) {
            return this.getStatus();
        }

        return this.start({
            jobs: persistedJobs.map((job) => ({
                playlistId: job.playlistId,
                contentType: job.contentType,
                xtreamId: job.xtreamId,
                seriesXtreamId: job.seriesXtreamId,
                seasonNumber: job.seasonNumber,
                episodeNumber: job.episodeNumber,
                url: job.url,
                headers: job.headers,
                staticMetadata: job.staticMetadata,
                sourceVpn: job.sourceVpn,
            })),
            seriesDiscoveryJobs: persistedSeriesDiscoveryJobs.map((job) => ({
                playlistId: job.playlistId,
                serverUrl: job.serverUrl,
                username: job.username,
                password: job.password,
                seriesXtreamId: job.seriesXtreamId,
                headers: job.headers,
                sourceVpn: job.sourceVpn,
            })),
            runAfterWindowClose:
                persistedJobs.some((job) => job.runAfterWindowClose) ||
                persistedSeriesDiscoveryJobs.some(
                    (job) => job.runAfterWindowClose
                ),
            concurrency: this.maxConcurrentProbes,
        });
    }

    async startDueScheduledWarmupFromDatabase(options: {
        schedule: BackgroundMetadataWarmupSchedule;
        concurrency?: number;
    }): Promise<MediaMetadataBackgroundStatus> {
        const db = await initDatabase();
        const playlists = await getAppPlaylists(db);
        const jobs: MediaMetadataBackgroundWarmJob[] = [];
        const seriesDiscoveryJobs: MediaMetadataBackgroundSeriesDiscoveryJob[] =
            [];

        for (const playlist of playlists) {
            const playlistId = this.readString(playlist._id);
            const playlistType = this.readString(playlist.type);
            const serverUrl = this.readString(playlist.serverUrl);
            const username = this.readString(playlist.username);
            const password = this.readString(playlist.password);

            if (
                playlistType !== 'xtream' ||
                !playlistId ||
                !serverUrl ||
                !username ||
                !password
            ) {
                continue;
            }

            const headers = this.buildPlaylistHeaders(playlist);
            const sourceVpn = this.getPlaylistSourceVpnContext(playlist);
            const metadataDueCondition = this.createMetadataDueCondition(
                options.schedule
            );
            const missingRows = await db
                .select({
                    type: schema.content.type,
                    xtreamId: schema.content.xtreamId,
                    directSource: schema.content.directSource,
                    title: schema.content.title,
                })
                .from(schema.content)
                .innerJoin(
                    schema.categories,
                    eq(schema.content.categoryId, schema.categories.id)
                )
                .where(
                    and(
                        eq(schema.categories.playlistId, playlistId),
                        metadataDueCondition
                    )
                );

            for (const row of missingRows) {
                if (row.type === 'series') {
                    seriesDiscoveryJobs.push({
                        playlistId,
                        serverUrl,
                        username,
                        password,
                        seriesXtreamId: row.xtreamId,
                        headers,
                        sourceVpn,
                    });
                    continue;
                }

                const url = this.buildXtreamContentUrl(
                    { serverUrl, username, password },
                    row.type,
                    row.xtreamId,
                    row.directSource,
                    row.title
                );
                if (!url) {
                    continue;
                }

                jobs.push({
                    playlistId,
                    contentType: row.type === 'movie' ? 'movie' : 'live',
                    xtreamId: row.xtreamId,
                    url,
                    headers,
                    staticMetadata: null,
                    sourceVpn,
                });
            }

            if (missingRows.length > 0) {
                await setAppState(
                    db,
                    this.buildScheduledWarmupLastRunKey(playlistId),
                    String(Date.now())
                ).catch(() => undefined);
            }
        }

        if (jobs.length === 0 && seriesDiscoveryJobs.length === 0) {
            return this.getStatus();
        }

        return this.start({
            jobs,
            seriesDiscoveryJobs,
            runAfterWindowClose: true,
            concurrency: options.concurrency,
        });
    }

    getStatus(): MediaMetadataBackgroundStatus {
        return { ...this.status };
    }

    shouldKeepAppAlive(): boolean {
        const keepAlive =
            this.status.running && this.status.allowRunAfterWindowClose;
        if (keepAlive) {
            this.drainQueues();
        }

        return keepAlive;
    }

    private buildScheduledWarmupLastRunKey(playlistId: string): string {
        return `${BACKGROUND_METADATA_LAST_RUN_KEY_PREFIX}:${playlistId}`;
    }

    private createMetadataDueCondition(
        schedule: BackgroundMetadataWarmupSchedule
    ) {
        const cutoff = getBackgroundMetadataFreshnessCutoff(schedule);
        if (cutoff === null) {
            return isNull(schema.content.mediaMetadata);
        }

        return or(
            isNull(schema.content.mediaMetadata),
            isNull(schema.content.mediaMetadataUpdatedAt),
            lt(schema.content.mediaMetadataUpdatedAt, cutoff)
        );
    }

    private buildPlaylistHeaders(
        playlist: Record<string, unknown>
    ): Record<string, string> {
        const headers: Record<string, string> = {};
        const userAgent = this.readString(playlist.userAgent);
        const referrer = this.readString(playlist.referrer);
        const origin = this.readString(playlist.origin);
        if (userAgent) {
            headers['User-Agent'] = userAgent;
        }
        if (referrer) {
            headers.Referer = referrer;
        }
        if (origin) {
            headers.Origin = origin;
        }
        return headers;
    }

    private getPlaylistSourceVpnContext(
        playlist: Record<string, unknown>
    ): SourceVpnRequestContext | undefined {
        if (this.readString(playlist.vpnProvider).toLowerCase() !== 'proton') {
            return undefined;
        }

        return normalizeJobSourceVpn({
            provider: 'proton',
            location: this.readString(playlist.vpnLocation) || undefined,
            sourceId: this.readString(playlist._id) || undefined,
            sourceTitle:
                this.readString(playlist.title) ||
                this.readString(playlist.name) ||
                undefined,
        });
    }

    private buildXtreamContentUrl(
        playlist: {
            serverUrl?: string;
            username?: string;
            password?: string;
        },
        contentType: 'live' | 'movie' | 'series',
        xtreamId: number,
        directSource?: string | null,
        title?: string | null
    ): string {
        if (directSource && /^https?:\/\//i.test(directSource)) {
            return directSource;
        }

        if (!playlist.serverUrl || !playlist.username || !playlist.password) {
            return '';
        }

        const serverUrl = playlist.serverUrl.replace(/\/+$/, '');
        const username = encodeURIComponent(playlist.username);
        const password = encodeURIComponent(playlist.password);

        if (contentType === 'live') {
            return `${serverUrl}/live/${username}/${password}/${xtreamId}.ts`;
        }

        if (contentType === 'movie') {
            return `${serverUrl}/movie/${username}/${password}/${xtreamId}.${this.inferContainerExtension(
                directSource,
                title
            )}`;
        }

        return '';
    }

    private inferContainerExtension(
        directSource?: string | null,
        title?: string | null
    ): string {
        const value = `${directSource ?? ''} ${title ?? ''}`;
        const match = value.match(
            /\.(mkv|mp4|avi|mov|ts|m2ts|webm|m3u8)(?:$|[?#\s])/i
        );
        return match?.[1]?.toLowerCase() ?? 'mp4';
    }

    private readString(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

    private hasVisibleWindows(): boolean {
        return BrowserWindow.getAllWindows().some(
            (window) => !window.isDestroyed()
        );
    }

    private getEffectiveProbeLimit(): number {
        return this.hasVisibleWindows()
            ? Math.min(
                  this.maxConcurrentProbes,
                  MAX_INTERACTIVE_BACKGROUND_PROBES
              )
            : this.maxConcurrentProbes;
    }

    private getEffectiveSeriesDiscoveryLimit(): number {
        return this.hasVisibleWindows()
            ? MAX_INTERACTIVE_SERIES_DISCOVERY
            : MAX_CONCURRENT_SERIES_DISCOVERY;
    }

    private clearInteractiveDrainTimers(): void {
        if (this.interactiveProbeTimer) {
            clearTimeout(this.interactiveProbeTimer);
            this.interactiveProbeTimer = null;
        }
        if (this.interactiveSeriesDiscoveryTimer) {
            clearTimeout(this.interactiveSeriesDiscoveryTimer);
            this.interactiveSeriesDiscoveryTimer = null;
        }
    }

    private scheduleInteractiveProbeDrain(delayMs: number): void {
        if (this.interactiveProbeTimer) {
            return;
        }

        this.interactiveProbeTimer = setTimeout(
            () => {
                this.interactiveProbeTimer = null;
                this.drainQueues();
            },
            Math.max(0, delayMs)
        );
    }

    private scheduleInteractiveSeriesDiscoveryDrain(delayMs: number): void {
        if (this.interactiveSeriesDiscoveryTimer) {
            return;
        }

        this.interactiveSeriesDiscoveryTimer = setTimeout(
            () => {
                this.interactiveSeriesDiscoveryTimer = null;
                this.drainQueues();
            },
            Math.max(0, delayMs)
        );
    }

    private shouldPauseForForegroundApp(): boolean {
        return (
            this.status.allowRunAfterWindowClose &&
            !process.argv.includes('--metadata-warmup')
        );
    }

    private drainQueuesWhenAllowed(): void {
        if (this.shouldPauseForForegroundApp()) {
            this.refreshPendingStatus();
            this.broadcastStatus(true);
            return;
        }

        this.drainQueues();
    }

    private drainQueues(): void {
        this.drainSeriesDiscoveryQueue();
        this.drainProbeQueue();
        this.finishIfComplete();
    }

    private dequeueNextSeriesDiscoveryJobForActiveNetwork():
        | MediaMetadataBackgroundSeriesDiscoveryJob
        | undefined {
        if (this.seriesDiscoveryQueue.length === 0) {
            return undefined;
        }

        if (!this.activeNetworkKey) {
            this.activeNetworkKey = getJobNetworkKey(
                this.seriesDiscoveryQueue[0].sourceVpn
            );
        }

        const index = this.seriesDiscoveryQueue.findIndex(
            (job) => getJobNetworkKey(job.sourceVpn) === this.activeNetworkKey
        );
        if (index < 0) {
            return undefined;
        }

        return this.seriesDiscoveryQueue.splice(index, 1)[0];
    }

    private dequeueNextProbeJobForActiveNetwork():
        | MediaMetadataBackgroundWarmJob
        | undefined {
        if (this.queue.length === 0) {
            return undefined;
        }

        if (!this.activeNetworkKey) {
            this.activeNetworkKey = getJobNetworkKey(this.queue[0].sourceVpn);
        }

        const index = this.queue.findIndex(
            (job) => getJobNetworkKey(job.sourceVpn) === this.activeNetworkKey
        );
        if (index < 0) {
            return undefined;
        }

        return this.queue.splice(index, 1)[0];
    }

    private releaseNetworkKeyIfIdle(): void {
        if (this.activeProbes === 0 && this.activeSeriesDiscoveries === 0) {
            this.activeNetworkKey = null;
        }
    }

    private drainSeriesDiscoveryQueue(): void {
        const runId = this.currentRunId;
        const interactive = this.hasVisibleWindows();
        if (interactive && this.activeSeriesDiscoveries > 0) {
            return;
        }
        if (interactive && this.seriesDiscoveryQueue.length > 0) {
            const elapsed =
                Date.now() - this.lastInteractiveSeriesDiscoveryStartedAt;
            if (elapsed < INTERACTIVE_SERIES_DISCOVERY_START_INTERVAL_MS) {
                this.scheduleInteractiveSeriesDiscoveryDrain(
                    INTERACTIVE_SERIES_DISCOVERY_START_INTERVAL_MS - elapsed
                );
                return;
            }
        }

        while (
            this.activeSeriesDiscoveries <
                this.getEffectiveSeriesDiscoveryLimit() &&
            this.seriesDiscoveryQueue.length > 0
        ) {
            const job = this.dequeueNextSeriesDiscoveryJobForActiveNetwork();
            if (!job) {
                break;
            }

            this.activeSeriesDiscoveries++;
            if (interactive) {
                this.lastInteractiveSeriesDiscoveryStartedAt = Date.now();
            }
            this.refreshPendingStatus();
            void this.runSeriesDiscovery(runId, job);
            if (interactive) {
                break;
            }
        }
    }

    private drainProbeQueue(): void {
        const runId = this.currentRunId;
        const interactive = this.hasVisibleWindows();
        if (interactive && this.activeProbes > 0) {
            this.finishIfComplete();
            return;
        }
        if (interactive && this.queue.length > 0) {
            const elapsed = Date.now() - this.lastInteractiveProbeStartedAt;
            if (elapsed < INTERACTIVE_PROBE_START_INTERVAL_MS) {
                this.scheduleInteractiveProbeDrain(
                    INTERACTIVE_PROBE_START_INTERVAL_MS - elapsed
                );
                this.finishIfComplete();
                return;
            }
        }

        while (
            this.activeProbes < this.getEffectiveProbeLimit() &&
            this.queue.length > 0
        ) {
            const job = this.dequeueNextProbeJobForActiveNetwork();
            if (!job) {
                break;
            }

            this.activeProbes++;
            if (interactive) {
                this.lastInteractiveProbeStartedAt = Date.now();
            }
            this.refreshPendingStatus();
            void this.runJob(runId, job);
            if (interactive) {
                break;
            }
        }

        this.finishIfComplete();
    }

    private async runJob(
        runId: number,
        job: MediaMetadataBackgroundWarmJob
    ): Promise<void> {
        const startedAt = Date.now();
        try {
            await ensureSourceNetworkReady(job.sourceVpn);
            const probed = await probeMediaStreamMetadata({
                url: job.url,
                headers: job.headers,
            });
            const metadata = mergeMetadata(probed, job.staticMetadata);

            if (runId === this.currentRunId) {
                await this.persistJobMetadata(job, metadata);
            }
        } catch (error) {
            if (runId === this.currentRunId) {
                this.status = {
                    ...this.status,
                    failedItems: this.status.failedItems + 1,
                    lastError:
                        error instanceof Error ? error.message : String(error),
                };

                const metadata = mergeMetadata(
                    unavailable(
                        this.status.lastError ?? 'Metadata probe failed'
                    ),
                    job.staticMetadata
                );
                await this.persistJobMetadata(job, metadata).catch(
                    () => undefined
                );
            }
        } finally {
            if (runId === this.currentRunId) {
                this.recordProbeDuration(Date.now() - startedAt);
            }
            await initDatabase()
                .then((db) => deleteMediaMetadataJob(db, createJobKey(job)))
                .catch(() => undefined);
            this.activeProbes = Math.max(0, this.activeProbes - 1);
            this.releaseNetworkKeyIfIdle();
            if (runId === this.currentRunId) {
                this.status = {
                    ...this.status,
                    processedItems: this.status.processedItems + 1,
                };
                this.refreshPendingStatus();
                this.broadcastStatus();
                this.drainQueues();
            }
        }
    }

    private async runSeriesDiscovery(
        runId: number,
        job: MediaMetadataBackgroundSeriesDiscoveryJob
    ): Promise<void> {
        try {
            const episodeJobs = await this.fetchSeriesEpisodeJobs(job);
            if (runId === this.currentRunId) {
                if (episodeJobs.length > 0) {
                    await this.start({
                        jobs: episodeJobs,
                        runAfterWindowClose: true,
                        concurrency: this.maxConcurrentProbes,
                    });
                } else if (
                    !(await this.persistSeriesAggregateFromCachedEpisodes(job))
                ) {
                    await this.persistSeriesDiscoveryUnavailable(
                        job,
                        'No series episodes returned for metadata discovery'
                    );
                }
            }
        } catch (error) {
            if (runId === this.currentRunId) {
                const message =
                    error instanceof Error ? error.message : String(error);
                this.status = {
                    ...this.status,
                    failedItems: this.status.failedItems + 1,
                    lastError: message,
                };
                await this.persistSeriesDiscoveryUnavailable(job, message).catch(
                    () => undefined
                );
            }
        } finally {
            await initDatabase()
                .then((db) =>
                    deleteMediaMetadataSeriesDiscoveryJob(
                        db,
                        createSeriesDiscoveryKey(job)
                    )
                )
                .catch(() => undefined);
            this.activeSeriesDiscoveries = Math.max(
                0,
                this.activeSeriesDiscoveries - 1
            );
            this.releaseNetworkKeyIfIdle();
            if (runId === this.currentRunId) {
                this.status = {
                    ...this.status,
                    processedItems: this.status.processedItems + 1,
                };
                this.refreshPendingStatus();
                this.broadcastStatus();
                this.drainQueues();
            }
        }
    }

    private async persistSeriesDiscoveryUnavailable(
        job: MediaMetadataBackgroundSeriesDiscoveryJob,
        reason: string
    ): Promise<void> {
        const metadata = unavailable(reason);
        const db = await initDatabase();
        await setContentMediaMetadata(
            db,
            job.playlistId,
            'series',
            Number(job.seriesXtreamId),
            metadata
        );
        this.broadcast({
            type: 'item',
            playlistId: job.playlistId,
            contentType: 'series',
            xtreamId: Number(job.seriesXtreamId),
            metadata,
            status: this.getStatus(),
        });
    }

    private async fetchSeriesEpisodeJobs(
        job: MediaMetadataBackgroundSeriesDiscoveryJob
    ): Promise<MediaMetadataBackgroundWarmJob[]> {
        const params = new URLSearchParams({
            username: job.username,
            password: job.password,
            action: 'get_series_info',
            series_id: String(job.seriesXtreamId),
        });
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            SERIES_DISCOVERY_TIMEOUT_MS
        );
        const url = `${job.serverUrl}/player_api.php?${params.toString()}`;

        try {
            await ensureSourceNetworkReady(job.sourceVpn);
            const response = await axios.get(url, {
                headers: job.headers,
                signal: controller.signal,
                timeout: SERIES_DISCOVERY_TIMEOUT_MS,
                validateStatus: () => true,
                ...getSourceAxiosAgents(),
            });
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Series metadata HTTP ${response.status}`);
            }

            const payload = response.data as {
                episodes?: unknown;
            };
            return this.createEpisodeJobsFromSeriesPayload(job, payload);
        } finally {
            clearTimeout(timeout);
        }
    }

    private async createEpisodeJobsFromSeriesPayload(
        job: MediaMetadataBackgroundSeriesDiscoveryJob,
        payload: { episodes?: unknown }
    ): Promise<MediaMetadataBackgroundWarmJob[]> {
        const descriptors = extractSeriesEpisodeDescriptors(payload);
        if (descriptors.length === 0) {
            return [];
        }

        const db = await initDatabase();
        const existingRows = await getEpisodeMediaMetadataForSeries(
            db,
            job.playlistId,
            Number(job.seriesXtreamId)
        );
        const existingByEpisodeId = new Map(
            existingRows.map((row) => [row.episodeXtreamId, row])
        );
        const episodeJobs: MediaMetadataBackgroundWarmJob[] = [];

        for (const descriptor of descriptors) {
            const episodeJob = this.createEpisodeJobFromSeriesEpisode(
                job,
                descriptor.episode,
                descriptor.seasonKey
            );
            if (!episodeJob) {
                continue;
            }

            const existing = existingByEpisodeId.get(episodeJob.xtreamId);
            const mergedExistingMetadata = existing
                ? mergeMetadata(
                      existing.mediaMetadata,
                      episodeJob.staticMetadata
                  )
                : episodeJob.staticMetadata;
            if (
                mergedExistingMetadata &&
                !metadataNeedsProbe(mergedExistingMetadata)
            ) {
                if (!existing || mergedExistingMetadata !== existing.mediaMetadata) {
                    await setEpisodeMediaMetadata(db, {
                        playlistId: episodeJob.playlistId,
                        seriesXtreamId: Number(episodeJob.seriesXtreamId),
                        episodeXtreamId: episodeJob.xtreamId,
                        seasonNumber: episodeJob.seasonNumber,
                        episodeNumber: episodeJob.episodeNumber,
                        metadata: mergedExistingMetadata,
                    });
                }
                continue;
            }

            episodeJobs.push(episodeJob);
        }

        return episodeJobs;
    }

    private createEpisodeJobFromSeriesEpisode(
        job: MediaMetadataBackgroundSeriesDiscoveryJob,
        episode: Record<string, unknown>,
        seasonKey?: string
    ): MediaMetadataBackgroundWarmJob | null {
        const info = readRecord(episode['info']);
        const movieData = readRecord(episode['movie_data']);
        const episodeXtreamId = readPositiveNumber(
            episode['id'] ??
                episode['episode_id'] ??
                episode['episodeId'] ??
                episode['stream_id']
        );
        const extension =
            readFirstString(
                episode['container_extension'],
                episode['containerExtension'],
                info?.['container_extension'],
                movieData?.['container_extension']
            ) ?? 'mp4';
        if (!episodeXtreamId) {
            return null;
        }

        const directSource = readFirstString(
            episode['direct_source'],
            episode['directSource'],
            info?.['direct_source'],
            movieData?.['direct_source']
        );

        return {
            playlistId: job.playlistId,
            contentType: 'episode',
            xtreamId: episodeXtreamId,
            seriesXtreamId: job.seriesXtreamId,
            seasonNumber:
                readPositiveNumber(episode['season']) ??
                readPositiveNumber(episode['season_number']) ??
                readPositiveNumber(seasonKey),
            episodeNumber:
                readPositiveNumber(episode['episode_num']) ??
                readPositiveNumber(episode['episodeNumber']) ??
                readPositiveNumber(episode['episode']),
            url:
                directSource && /^https?:\/\//i.test(directSource)
                    ? directSource
                    : `${job.serverUrl}/series/${job.username}/${job.password}/${episodeXtreamId}.${extension}`,
            headers: job.headers,
            staticMetadata: buildEpisodeStaticMetadata(episode),
            sourceVpn: job.sourceVpn,
        };
    }

    private async persistSeriesAggregateFromCachedEpisodes(
        job: MediaMetadataBackgroundSeriesDiscoveryJob
    ): Promise<boolean> {
        const db = await initDatabase();
        const rows = await getEpisodeMediaMetadataForSeries(
            db,
            job.playlistId,
            Number(job.seriesXtreamId)
        );
        const seriesMetadata = aggregateSeriesEpisodeMetadata(
            rows.map((row) => row.mediaMetadata)
        );
        if (!seriesMetadata) {
            return false;
        }

        await setContentMediaMetadata(
            db,
            job.playlistId,
            'series',
            Number(job.seriesXtreamId),
            seriesMetadata
        );
        this.broadcast({
            type: 'item',
            playlistId: job.playlistId,
            contentType: 'series',
            xtreamId: Number(job.seriesXtreamId),
            metadata: seriesMetadata,
            status: this.getStatus(),
        });
        return true;
    }

    private async persistJobMetadata(
        job: MediaMetadataBackgroundWarmJob,
        metadata: MediaStreamMetadata
    ): Promise<void> {
        const db = await initDatabase();

        if (job.contentType === 'episode') {
            await setEpisodeMediaMetadata(db, {
                playlistId: job.playlistId,
                seriesXtreamId: Number(job.seriesXtreamId),
                episodeXtreamId: job.xtreamId,
                seasonNumber: job.seasonNumber,
                episodeNumber: job.episodeNumber,
                metadata,
            });
            this.broadcastItem(job, metadata);

            if (job.seriesXtreamId) {
                const rows = await getEpisodeMediaMetadataForSeries(
                    db,
                    job.playlistId,
                    Number(job.seriesXtreamId)
                );
                const seriesMetadata = aggregateSeriesEpisodeMetadata(
                    rows.map((row) => row.mediaMetadata)
                );
                if (seriesMetadata) {
                    await setContentMediaMetadata(
                        db,
                        job.playlistId,
                        'series',
                        Number(job.seriesXtreamId),
                        seriesMetadata
                    );
                    this.broadcast({
                        type: 'item',
                        playlistId: job.playlistId,
                        contentType: 'series',
                        xtreamId: Number(job.seriesXtreamId),
                        metadata: seriesMetadata,
                        status: this.getStatus(),
                    });
                }
            }
            return;
        }

        await setContentMediaMetadata(
            db,
            job.playlistId,
            job.contentType,
            job.xtreamId,
            metadata
        );
        this.broadcastItem(job, metadata);
    }

    private broadcastItem(
        job: MediaMetadataBackgroundWarmJob,
        metadata: MediaStreamMetadata
    ): void {
        this.broadcast({
            type: 'item',
            playlistId: job.playlistId,
            contentType: job.contentType,
            xtreamId: job.xtreamId,
            metadata,
            status: this.getStatus(),
        });
    }

    private async persistJobs(
        jobs: readonly MediaMetadataBackgroundWarmJob[],
        seriesDiscoveryJobs: readonly MediaMetadataBackgroundSeriesDiscoveryJob[],
        runAfterWindowClose: boolean
    ): Promise<void> {
        if (
            !runAfterWindowClose ||
            (jobs.length === 0 && seriesDiscoveryJobs.length === 0)
        ) {
            return;
        }

        const persistedJobs: PersistedMediaMetadataJob[] = jobs.map((job) => ({
            jobKey: createJobKey(job),
            playlistId: job.playlistId,
            contentType: job.contentType,
            xtreamId: job.xtreamId,
            seriesXtreamId: job.seriesXtreamId,
            seasonNumber: job.seasonNumber,
            episodeNumber: job.episodeNumber,
            url: job.url,
            headers: job.headers,
            staticMetadata: job.staticMetadata,
            sourceVpn: job.sourceVpn,
            runAfterWindowClose,
        }));
        const persistedSeriesDiscoveryJobs: PersistedMediaMetadataSeriesDiscoveryJob[] =
            seriesDiscoveryJobs.map((job) => ({
                jobKey: createSeriesDiscoveryKey(job),
                playlistId: job.playlistId,
                serverUrl: job.serverUrl,
                username: job.username,
                password: job.password,
                seriesXtreamId: job.seriesXtreamId,
                headers: job.headers,
                sourceVpn: job.sourceVpn,
                runAfterWindowClose,
            }));
        const db = await initDatabase();
        await upsertMediaMetadataJobs(db, persistedJobs);
        await upsertMediaMetadataSeriesDiscoveryJobs(
            db,
            persistedSeriesDiscoveryJobs
        );
    }

    private refreshPendingStatus(): void {
        this.status = {
            ...this.status,
            pendingItems:
                this.queue.length +
                this.activeProbes +
                this.seriesDiscoveryQueue.length +
                this.activeSeriesDiscoveries,
        };
    }

    private recordProbeDuration(durationMs: number): void {
        const processedBeforeCurrent = Math.max(0, this.status.processedItems);
        const previousAverage = this.status.averageProbeMs ?? durationMs;
        const averageProbeMs =
            (previousAverage * processedBeforeCurrent + durationMs) /
            (processedBeforeCurrent + 1);
        const elapsedMs = Math.max(
            1,
            Date.now() - (this.status.startedAt ?? Date.now())
        );
        const itemsPerMinute =
            ((processedBeforeCurrent + 1) / elapsedMs) * 60_000;

        this.status = {
            ...this.status,
            averageProbeMs: Math.round(averageProbeMs),
            itemsPerMinute: Math.round(itemsPerMinute * 10) / 10,
            lastProbeMs: durationMs,
        };
    }

    private finishIfComplete(): void {
        if (
            this.queue.length > 0 ||
            this.activeProbes > 0 ||
            this.seriesDiscoveryQueue.length > 0 ||
            this.activeSeriesDiscoveries > 0
        ) {
            return;
        }

        if (!this.status.running) {
            return;
        }

        this.status = {
            ...this.status,
            allowRunAfterWindowClose: false,
            completedAt: Date.now(),
            pendingItems: 0,
            running: false,
        };
        this.broadcastStatus(true);

        if (BrowserWindow.getAllWindows().length === 0) {
            setTimeout(() => {
                if (
                    !this.shouldKeepAppAlive() &&
                    BrowserWindow.getAllWindows().length === 0
                ) {
                    app.quit();
                }
            }, 50);
        }
    }

    private broadcastStatus(force = false): void {
        const now = Date.now();
        if (
            !force &&
            this.status.running &&
            now - this.lastStatusBroadcastAt < STATUS_BROADCAST_MIN_INTERVAL_MS
        ) {
            return;
        }

        this.lastStatusBroadcastAt = now;
        this.broadcast({
            type: 'status',
            status: this.getStatus(),
        });
    }

    private broadcast(event: MediaMetadataBackgroundEvent): void {
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
                window.webContents.send(MEDIA_METADATA_BACKGROUND_EVENT, event);
            }
        }
    }

    private isValidJob(job: MediaMetadataBackgroundWarmJob): boolean {
        return Boolean(
            job &&
            job.playlistId &&
            (job.contentType === 'live' ||
                job.contentType === 'movie' ||
                job.contentType === 'episode') &&
            Number.isFinite(Number(job.xtreamId)) &&
            Number(job.xtreamId) > 0 &&
            (job.contentType !== 'episode' ||
                (Number.isFinite(Number(job.seriesXtreamId)) &&
                    Number(job.seriesXtreamId) > 0)) &&
            typeof job.url === 'string' &&
            /^https?:\/\//i.test(job.url)
        );
    }

    private isValidSeriesDiscoveryJob(
        job: MediaMetadataBackgroundSeriesDiscoveryJob
    ): boolean {
        return Boolean(
            job &&
            job.playlistId &&
            typeof job.serverUrl === 'string' &&
            /^https?:\/\//i.test(job.serverUrl) &&
            typeof job.username === 'string' &&
            job.username &&
            typeof job.password === 'string' &&
            job.password &&
            Number.isFinite(Number(job.seriesXtreamId)) &&
            Number(job.seriesXtreamId) > 0
        );
    }
}

export const mediaMetadataBackgroundWarmup =
    new MediaMetadataBackgroundWarmupService();
