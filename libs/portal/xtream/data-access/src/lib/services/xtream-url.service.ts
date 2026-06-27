import { inject, Injectable } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    StreamFormat,
    XtreamSerieEpisode,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import { DatabaseService, SettingsStore } from '@iptvnator/services';
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
    [key: string]: unknown;
}

type XtreamVodStreamLike = XtreamVodDetails & {
    readonly stream_id?: number;
};

const XTREAM_CATCHUP_SCHEME = {
    LEGACY: 'legacy',
    REST: 'rest',
} as const;

type XtreamCatchupScheme =
    (typeof XTREAM_CATCHUP_SCHEME)[keyof typeof XTREAM_CATCHUP_SCHEME];

const XTREAM_CATCHUP_VARIANT = {
    LEGACY: 'legacy',
    LEGACY_M3U8: 'legacy:m3u8',
    LEGACY_TS: 'legacy:ts',
    REST_M3U8: 'rest:m3u8',
    REST_TS: 'rest:ts',
} as const;

type XtreamCatchupVariant =
    (typeof XTREAM_CATCHUP_VARIANT)[keyof typeof XTREAM_CATCHUP_VARIANT];

const XTREAM_CATCHUP_EXTENSIONS = {
    M3U8: 'm3u8',
    TS: 'ts',
} as const;

type XtreamCatchupExtension =
    (typeof XTREAM_CATCHUP_EXTENSIONS)[keyof typeof XTREAM_CATCHUP_EXTENSIONS];

interface NormalizedXtreamCredentials {
    password: string;
    rawPassword: string;
    rawUsername: string;
    serverUrl: string;
    username: string;
}

type XtreamProbeApi = {
    xtreamProbeUrl?: (
        url: string,
        method?: 'GET' | 'HEAD'
    ) => Promise<{ status: number }>;
};

const XTREAM_CATCHUP_VARIANT_KEY_PREFIX = 'xtream-catchup-variant:v4:';

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
        XtreamCatchupVariant
    >();
    private readonly catchupSchemeRequests = new Map<
        string,
        Promise<XtreamCatchupVariant>
    >();

    /**
     * Construct live stream URL
     * Format: {serverUrl}/live/{username}/{password}/{streamId}.{format}
     */
    constructLiveUrl(
        credentials: XtreamCredentials,
        xtreamId: number,
        format?: string
    ): string {
        const normalizedCredentials = this.normalizeCredentials(credentials);
        if (!normalizedCredentials) {
            return '';
        }

        const streamFormat = this.resolveLiveStreamFormat(
            credentials,
            format ??
                this.settingsStore.streamFormat() ??
                StreamFormat.AutoStreamFormat
        );
        return `${normalizedCredentials.serverUrl}/live/${normalizedCredentials.username}/${normalizedCredentials.password}/${xtreamId}.${streamFormat}`;
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
        const streamId = vod.movie_data?.stream_id ?? vod.stream_id;
        const extension = vodItem.movie_data?.container_extension;
        if (!streamId || !extension) {
            return '';
        }
        const normalizedCredentials = this.normalizeCredentials(credentials);
        if (!normalizedCredentials) {
            return '';
        }

        return `${normalizedCredentials.serverUrl}/movie/${normalizedCredentials.username}/${normalizedCredentials.password}/${streamId}.${extension}`;
    }

    /**
     * Construct series episode stream URL
     * Format: {serverUrl}/series/{username}/{password}/{episodeId}.{extension}
     */
    constructEpisodeUrl(
        credentials: XtreamCredentials,
        episode: XtreamSerieEpisode
    ): string {
        const normalizedCredentials = this.normalizeCredentials(credentials);
        if (!normalizedCredentials) {
            return '';
        }

        return `${normalizedCredentials.serverUrl}/series/${normalizedCredentials.username}/${normalizedCredentials.password}/${episode.id}.${episode.container_extension}`;
    }

    constructCatchupUrl(
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        scheme: XtreamCatchupScheme | XtreamCatchupVariant,
        serverTimezone?: string
    ): string {
        const normalizedCredentials = this.normalizeCredentials(credentials);
        if (!normalizedCredentials) {
            return '';
        }

        const durationMinutes = Math.max(
            1,
            Math.round((stopTimestamp - startTimestamp) / 60)
        );
        const timeString = this.formatCatchupStartTime(
            startTimestamp,
            serverTimezone
        );
        const variant = this.normalizeCatchupVariant(scheme);
        const extension = this.getCatchupVariantExtension(variant);

        if (variant.startsWith(XTREAM_CATCHUP_SCHEME.LEGACY)) {
            const params = new URLSearchParams({
                username: normalizedCredentials.rawUsername,
                password: normalizedCredentials.rawPassword,
                stream: String(streamId),
                start: timeString,
                duration: String(durationMinutes),
            });
            if (extension) {
                params.set('extension', extension);
            }
            return `${normalizedCredentials.serverUrl}/streaming/timeshift.php?${params.toString()}`;
        }

        return `${normalizedCredentials.serverUrl}/timeshift/${normalizedCredentials.username}/${normalizedCredentials.password}/${durationMinutes}/${timeString}/${streamId}.${extension ?? XTREAM_CATCHUP_EXTENSIONS.TS}`;
    }

    async resolveCatchupUrl(
        playlistId: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<string> {
        const variant = await this.getCatchupVariant(
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
            variant,
            serverTimezone
        );
    }

    private async getCatchupVariant(
        playlistId: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<XtreamCatchupVariant> {
        const cacheKey = this.getCatchupVariantCacheKey(
            playlistId,
            credentials
        );
        const cached = this.catchupSchemeCache.get(cacheKey);
        if (cached) {
            return this.normalizeCatchupVariant(cached);
        }

        const persisted = await this.databaseService.getAppState(cacheKey);
        const persistedVariant = this.parseCatchupVariant(persisted);
        if (persistedVariant) {
            this.catchupSchemeCache.set(cacheKey, persistedVariant);
            return persistedVariant;
        }

        const inFlightRequest = this.catchupSchemeRequests.get(cacheKey);
        if (inFlightRequest) {
            return inFlightRequest;
        }

        const request = this.detectCatchupVariant(
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

    private async detectCatchupVariant(
        cacheKey: string,
        credentials: XtreamCredentials,
        streamId: number,
        startTimestamp: number,
        stopTimestamp: number,
        serverTimezone?: string
    ): Promise<XtreamCatchupVariant> {
        for (const variant of this.getCatchupVariantCandidates(credentials)) {
            const url = this.constructCatchupUrl(
                credentials,
                streamId,
                startTimestamp,
                stopTimestamp,
                variant,
                serverTimezone
            );
            if (!url) {
                continue;
            }

            const status = await this.probeCatchupUrl(url);
            if (this.isAcceptedCatchupProbeStatus(status)) {
                this.catchupSchemeCache.set(cacheKey, variant);
                await this.databaseService.setAppState(cacheKey, variant);
                return variant;
            }
        }

        this.catchupSchemeCache.set(cacheKey, XTREAM_CATCHUP_VARIANT.REST_TS);
        await this.databaseService.setAppState(
            cacheKey,
            XTREAM_CATCHUP_VARIANT.REST_TS
        );
        return XTREAM_CATCHUP_VARIANT.REST_TS;
    }

    private async probeCatchupUrl(url: string): Promise<number> {
        const probeUrl = (window.electron as XtreamProbeApi | undefined)
            ?.xtreamProbeUrl;

        if (typeof probeUrl !== 'function') {
            return 0;
        }

        try {
            const result = await probeUrl(url, 'GET');
            return Number(result?.status ?? 0);
        } catch {
            return 0;
        }
    }

    private isAcceptedCatchupProbeStatus(status: number): boolean {
        return status === 200 || status === 206;
    }

    private getCatchupVariantCandidates(
        credentials: XtreamCredentials
    ): XtreamCatchupVariant[] {
        const variants: XtreamCatchupVariant[] = [];

        for (const extension of this.getPreferredCatchupExtensions(
            credentials
        )) {
            variants.push(
                extension === XTREAM_CATCHUP_EXTENSIONS.M3U8
                    ? XTREAM_CATCHUP_VARIANT.REST_M3U8
                    : XTREAM_CATCHUP_VARIANT.REST_TS
            );
            variants.push(
                extension === XTREAM_CATCHUP_EXTENSIONS.M3U8
                    ? XTREAM_CATCHUP_VARIANT.LEGACY_M3U8
                    : XTREAM_CATCHUP_VARIANT.LEGACY_TS
            );
        }

        variants.push(XTREAM_CATCHUP_VARIANT.LEGACY);

        return [...new Set(variants)];
    }

    private getPreferredCatchupExtensions(
        credentials: XtreamCredentials
    ): XtreamCatchupExtension[] {
        const allowedFormats =
            this.getNormalizedAllowedOutputFormats(credentials);
        const formats =
            allowedFormats && allowedFormats.length > 0
                ? allowedFormats
                : [
                      XTREAM_CATCHUP_EXTENSIONS.M3U8,
                      XTREAM_CATCHUP_EXTENSIONS.TS,
                  ];

        const preferred = [
            XTREAM_CATCHUP_EXTENSIONS.TS,
            XTREAM_CATCHUP_EXTENSIONS.M3U8,
        ].filter((format) => formats.includes(format));

        return preferred.length > 0
            ? preferred
            : [XTREAM_CATCHUP_EXTENSIONS.TS];
    }

    private getCatchupVariantCacheKey(
        playlistId: string,
        credentials: XtreamCredentials
    ): string {
        const allowedFormats =
            this.getNormalizedAllowedOutputFormats(credentials);
        const formatSignature =
            allowedFormats && allowedFormats.length > 0
                ? [...new Set(allowedFormats)]
                      .sort()
                      .map((format) => encodeURIComponent(format))
                      .join(',')
                : 'unknown';

        return `${XTREAM_CATCHUP_VARIANT_KEY_PREFIX}${playlistId}:formats:${formatSignature}`;
    }

    private getNormalizedAllowedOutputFormats(
        credentials: XtreamCredentials
    ): string[] | undefined {
        const allowedFormats = credentials.allowedOutputFormats
            ?.map((format) => format.trim().toLowerCase())
            .filter(Boolean);

        return allowedFormats && allowedFormats.length > 0
            ? allowedFormats
            : undefined;
    }

    private normalizeCatchupVariant(
        scheme: XtreamCatchupScheme | XtreamCatchupVariant
    ): XtreamCatchupVariant {
        return (
            this.parseCatchupVariant(scheme) ?? XTREAM_CATCHUP_VARIANT.REST_TS
        );
    }

    private parseCatchupVariant(
        value: string | null
    ): XtreamCatchupVariant | null {
        const variants = Object.values(XTREAM_CATCHUP_VARIANT);
        return variants.includes(value as XtreamCatchupVariant)
            ? (value as XtreamCatchupVariant)
            : null;
    }

    private getCatchupVariantExtension(
        variant: XtreamCatchupVariant
    ): XtreamCatchupExtension | null {
        if (
            variant === XTREAM_CATCHUP_VARIANT.REST_M3U8 ||
            variant === XTREAM_CATCHUP_VARIANT.LEGACY_M3U8
        ) {
            return XTREAM_CATCHUP_EXTENSIONS.M3U8;
        }

        if (
            variant === XTREAM_CATCHUP_VARIANT.REST_TS ||
            variant === XTREAM_CATCHUP_VARIANT.LEGACY_TS
        ) {
            return XTREAM_CATCHUP_EXTENSIONS.TS;
        }

        return null;
    }

    private normalizeCredentials(
        credentials: XtreamCredentials
    ): NormalizedXtreamCredentials | null {
        const rawUsername = credentials.username.trim();
        const rawPassword = credentials.password.trim();
        if (!rawUsername || !rawPassword) {
            return null;
        }

        let serverUrl: string;
        try {
            serverUrl = normalizeXtreamServerUrl(credentials.serverUrl);
        } catch {
            return null;
        }

        return {
            password: encodeURIComponent(rawPassword),
            rawPassword,
            rawUsername,
            serverUrl,
            username: encodeURIComponent(rawUsername),
        };
    }

    private resolveLiveStreamFormat(
        credentials: XtreamCredentials,
        requestedFormat: string
    ): string {
        const requested = requestedFormat.trim().toLowerCase();
        const allowedFormats =
            this.getNormalizedAllowedOutputFormats(credentials);

        if (!requested || requested === StreamFormat.AutoStreamFormat) {
            return this.resolveAutoLiveStreamFormat(allowedFormats);
        }

        if (allowedFormats?.length && !allowedFormats.includes(requested)) {
            return allowedFormats[0];
        }

        return requested;
    }

    private resolveAutoLiveStreamFormat(
        allowedFormats: string[] | undefined
    ): string {
        if (!allowedFormats?.length) {
            return StreamFormat.M3u8StreamFormat;
        }

        if (allowedFormats.includes(StreamFormat.M3u8StreamFormat)) {
            return StreamFormat.M3u8StreamFormat;
        }

        if (allowedFormats.includes(StreamFormat.TsStreamFormat)) {
            return StreamFormat.TsStreamFormat;
        }

        return allowedFormats[0];
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
