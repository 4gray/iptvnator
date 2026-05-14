import { inject, Injectable } from '@angular/core';
import { XtreamSerieEpisode, XtreamVodDetails } from 'shared-interfaces';
import { DatabaseService, SettingsStore } from 'services';
import { XtreamCredentials } from './xtream-api.service';

/**
 * Extended playlist with optional HTTP headers
 */
export interface XtreamPlaylistWithHeaders extends XtreamCredentials {
    id: string;
    name: string;
    type?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
}

/**
 * Live stream item with xtream_id
 */
export interface LiveStreamItem {
    xtream_id: number;
    direct_source?: string | null;
    directSource?: string | null;
}

type XtreamVodStreamLike = XtreamVodDetails & {
    readonly stream_id?: number;
    readonly direct_source?: string | null;
    readonly directSource?: string | null;
};

type XtreamCatchupScheme = 'rest' | 'legacy';

type XtreamProbeApi = {
    xtreamProbeUrl?: (
        url: string,
        method?: 'GET' | 'HEAD'
    ) => Promise<{ status: number }>;
};

const XTREAM_CATCHUP_SCHEME_KEY_PREFIX = 'xtream-catchup-scheme:';

/**
 * Service for constructing Xtream stream URLs.
 * Handles URL construction for live streams, VOD, and series episodes.
 */
@Injectable({ providedIn: 'root' })
export class XtreamUrlService {
    private readonly databaseService = inject(DatabaseService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly catchupSchemeCache = new Map<
        string,
        XtreamCatchupScheme
    >();
    private readonly catchupSchemeRequests = new Map<
        string,
        Promise<XtreamCatchupScheme>
    >();

    /**
     * Construct live stream URL
     * Format: {serverUrl}/live/{username}/{password}/{streamId}.{format}
     */
    constructLiveUrl(
        credentials: XtreamCredentials,
        xtreamId: number,
        format?: string,
        item?: LiveStreamItem | null
    ): string {
        const directSource = this.getDirectSourceUrl(item);
        if (directSource) {
            return directSource;
        }

        const streamFormat =
            format ?? this.settingsStore.streamFormat() ?? 'ts';
        return `${credentials.serverUrl}/live/${credentials.username}/${credentials.password}/${xtreamId}.${streamFormat}`;
    }

    /**
     * Construct VOD stream URL
     * Format: {serverUrl}/movie/{username}/{password}/{streamId}.{extension}
     */
    constructVodUrl(
        credentials: XtreamCredentials,
        vodItem: XtreamVodDetails
    ): string {
        const vod = vodItem as XtreamVodStreamLike;
        const directSource = this.getDirectSourceUrl(vodItem.movie_data, vod);
        if (directSource) {
            return directSource;
        }

        const streamId = vod.movie_data?.stream_id ?? vod.stream_id;
        const extension = vodItem.movie_data?.container_extension;
        if (!streamId || !extension) {
            return '';
        }
        return `${credentials.serverUrl}/movie/${credentials.username}/${credentials.password}/${streamId}.${extension}`;
    }

    /**
     * Construct series episode stream URL
     * Format: {serverUrl}/series/{username}/{password}/{episodeId}.{extension}
     */
    constructEpisodeUrl(
        credentials: XtreamCredentials,
        episode: XtreamSerieEpisode
    ): string {
        const directSource = this.getDirectSourceUrl(episode);
        if (directSource) {
            return directSource;
        }

        return `${credentials.serverUrl}/series/${credentials.username}/${credentials.password}/${episode.id}.${episode.container_extension}`;
    }

    constructCatchupUrl(
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        scheme: XtreamCatchupScheme,
        serverTimezone?: string
    ): string {
        const durationMinutes = Math.max(
            1,
            Math.round((stopTimestamp - startTimestamp) / 60)
        );
        const timeString = this.formatCatchupStartTime(
            startTimestamp,
            serverTimezone
        );

        if (scheme === 'legacy') {
            const params = new URLSearchParams({
                username: credentials.username,
                password: credentials.password,
                stream: String(streamId),
                start: timeString,
                duration: String(durationMinutes),
            });
            return `${credentials.serverUrl}/streaming/timeshift.php?${params.toString()}`;
        }

        return `${credentials.serverUrl}/timeshift/${credentials.username}/${credentials.password}/${durationMinutes}/${timeString}/${streamId}.ts`;
    }

    async resolveCatchupUrl(
        playlistId: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<string> {
        const scheme = await this.getCatchupScheme(
            playlistId,
            credentials,
            streamId,
            startTimestamp,
            stopTimestamp,
            serverTimezone
        );

        return this.constructCatchupUrl(
            credentials,
            streamId,
            startTimestamp,
            stopTimestamp,
            scheme,
            serverTimezone
        );
    }

    private async getCatchupScheme(
        playlistId: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<XtreamCatchupScheme> {
        const cacheKey = `${XTREAM_CATCHUP_SCHEME_KEY_PREFIX}${playlistId}`;
        const cached = this.catchupSchemeCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const persisted = await this.databaseService.getAppState(cacheKey);
        if (persisted === 'rest' || persisted === 'legacy') {
            this.catchupSchemeCache.set(cacheKey, persisted);
            return persisted;
        }

        const inFlightRequest = this.catchupSchemeRequests.get(cacheKey);
        if (inFlightRequest) {
            return inFlightRequest;
        }

        const request = this.detectCatchupScheme(
            cacheKey,
            credentials,
            streamId,
            startTimestamp,
            stopTimestamp,
            serverTimezone
        ).finally(() => {
            this.catchupSchemeRequests.delete(cacheKey);
        });

        this.catchupSchemeRequests.set(cacheKey, request);
        return request;
    }

    private async detectCatchupScheme(
        cacheKey: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<XtreamCatchupScheme> {
        const restUrl = this.constructCatchupUrl(
            credentials,
            streamId,
            startTimestamp,
            stopTimestamp,
            'rest',
            serverTimezone
        );
        const legacyUrl = this.constructCatchupUrl(
            credentials,
            streamId,
            startTimestamp,
            stopTimestamp,
            'legacy',
            serverTimezone
        );

        const restStatus = await this.probeCatchupUrl(restUrl);
        let detectedScheme: XtreamCatchupScheme;

        if (this.isAcceptedCatchupProbeStatus(restStatus)) {
            detectedScheme = 'rest';
        } else {
            const legacyStatus = await this.probeCatchupUrl(legacyUrl);
            detectedScheme = this.isAcceptedCatchupProbeStatus(legacyStatus)
                ? 'legacy'
                : restStatus === 404
                  ? 'legacy'
                  : 'rest';
        }

        this.catchupSchemeCache.set(cacheKey, detectedScheme);
        await this.databaseService.setAppState(cacheKey, detectedScheme);
        return detectedScheme;
    }

    private async probeCatchupUrl(url: string): Promise<number> {
        const probeUrl = (window.electron as XtreamProbeApi | undefined)
            ?.xtreamProbeUrl;

        if (typeof probeUrl !== 'function') {
            return 0;
        }

        try {
            const result = await probeUrl(url, 'HEAD');
            return Number(result?.status ?? 0);
        } catch {
            return 0;
        }
    }

    private isAcceptedCatchupProbeStatus(status: number): boolean {
        return (
            (status >= 200 && status < 400) ||
            status === 401 ||
            status === 403 ||
            status === 405
        );
    }

    private getDirectSourceUrl(
        ...candidates: Array<
            | {
                  readonly direct_source?: unknown;
                  readonly directSource?: unknown;
              }
            | null
            | undefined
        >
    ): string | null {
        if (
            this.settingsStore.redirectIndirectStreamsToDirectSource?.() !==
            true
        ) {
            return null;
        }

        for (const candidate of candidates) {
            const url = this.normalizeDirectSourceUrl(
                candidate?.direct_source ?? candidate?.directSource
            );
            if (url) {
                return url;
            }
        }

        return null;
    }

    private normalizeDirectSourceUrl(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = new URL(trimmed);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
                ? trimmed
                : null;
        } catch {
            return null;
        }
    }

    private formatCatchupStartTime(
        timestamp: number,
        timezone?: string
    ): string {
        const date = new Date(timestamp * 1000);

        if (timezone) {
            try {
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                }).formatToParts(date);
                const get = (type: Intl.DateTimeFormatPartTypes) =>
                    parts.find((p) => p.type === type)?.value ?? '00';
                return `${get('year')}-${get('month')}-${get('day')}:${get('hour')}-${get('minute')}`;
            } catch {
                // Invalid timezone string — fall through to local-time formatting
            }
        }

        const pad = (value: number) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
    }
}
