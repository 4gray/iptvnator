import { inject, Injectable } from '@angular/core';
import {
    formatXtreamCatchupStart,
    normalizeXtreamServerUrl,
    StreamFormat,
    XtreamSerieEpisode,
    XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import { DatabaseService, SettingsStore } from '@iptvnator/services';
import { XtreamCredentials } from './xtream-api.service';
import { resolveXtreamVodPlaybackSource } from './xtream-vod-playback-source';

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
    probeStreamUrl?: (
        url: string,
        method?: 'GET' | 'HEAD',
        headers?: {
            userAgent?: string | null;
            referer?: string | null;
            origin?: string | null;
        }
    ) => Promise<{ status: number }>;
};

// v5: v4 values may be a REST TS fallback stored after probes that lacked
// the playlist's headers; they are ignored and probed again once.
const XTREAM_CATCHUP_VARIANT_KEY_PREFIX = 'xtream-catchup-variant:v5:';
/** How long an unproven programme answers with the fallback without probing. */
const XTREAM_CATCHUP_FALLBACK_TTL_MS = 60_000;
/** Bounds the hold map; the oldest entries go first. */
const XTREAM_CATCHUP_FALLBACK_MAX_HOLDS = 64;

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
    /** Unproven programmes: until when they skip probing (memory only). */
    private readonly catchupFallbackUntil = new Map<string, number>();

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

    /** No probe: eligibility is explicit account evidence plus the user's Auto intent. */
    constructAutoLiveTsUrl(
        credentials: XtreamCredentials,
        xtreamId: number
    ): string | undefined {
        const requested =
            this.settingsStore.streamFormat() ?? StreamFormat.AutoStreamFormat;
        const formats = this.getNormalizedAllowedOutputFormats(credentials);
        if (
            requested !== StreamFormat.AutoStreamFormat ||
            !formats?.includes('m3u8') ||
            !formats.includes('ts')
        )
            return undefined;
        return (
            this.constructLiveUrl(
                credentials,
                xtreamId,
                StreamFormat.TsStreamFormat
            ) || undefined
        );
    }

    /**
     * Construct VOD stream URL
     * Format: {serverUrl}/movie/{username}/{password}/{streamId}.{extension}
     */
    constructVodUrl(
        credentials: XtreamCredentials,
        vodItem: XtreamVodDetails
    ): string {
        const source = resolveXtreamVodPlaybackSource(vodItem);
        if (!source) {
            return '';
        }
        if (source.directSource) return source.directSource;
        const normalizedCredentials = this.normalizeCredentials(credentials);
        if (!normalizedCredentials) {
            return '';
        }

        return `${normalizedCredentials.serverUrl}/movie/${normalizedCredentials.username}/${normalizedCredentials.password}/${source.streamId}.${source.containerExtension}`;
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

        const holdKey = `${cacheKey}:${streamId}:${startTimestamp}`;
        if (this.isFallbackHeld(holdKey)) {
            return XTREAM_CATCHUP_VARIANT.REST_TS;
        }

        const inFlightRequest = this.catchupSchemeRequests.get(cacheKey);
        if (inFlightRequest) {
            return inFlightRequest;
        }

        const request = this.detectCatchupVariant(
            cacheKey,
            holdKey,
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
        holdKey: string,
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

            const status = await this.probeCatchupUrl(url, credentials);
            if (this.isAcceptedCatchupProbeStatus(status)) {
                this.catchupSchemeCache.set(cacheKey, variant);
                await this.databaseService.setAppState(cacheKey, variant);
                return variant;
            }
        }

        // Nothing proved playable: a network failure, a programme without
        // archive, or no probe at all (PWA). Use the REST MPEG-TS fallback,
        // but never persist it: that would pin every later catch-up of the
        // playlist to a URL the panel may not serve. A short in-memory hold
        // keeps replaying the same programme from costing every probe again;
        // it is per programme, as one without archive says nothing about
        // the playlist's other programmes.
        this.holdFallback(holdKey);
        return XTREAM_CATCHUP_VARIANT.REST_TS;
    }

    private isFallbackHeld(holdKey: string): boolean {
        const until = this.catchupFallbackUntil.get(holdKey);
        if (until === undefined) return false;
        if (until > Date.now()) return true;
        this.catchupFallbackUntil.delete(holdKey);
        return false;
    }

    /** Drops expired holds, then the oldest beyond the cap. */
    private holdFallback(holdKey: string): void {
        const now = Date.now();
        for (const [key, until] of this.catchupFallbackUntil) {
            if (until <= now) this.catchupFallbackUntil.delete(key);
        }
        this.catchupFallbackUntil.delete(holdKey);
        this.catchupFallbackUntil.set(
            holdKey,
            now + XTREAM_CATCHUP_FALLBACK_TTL_MS
        );
        while (
            this.catchupFallbackUntil.size > XTREAM_CATCHUP_FALLBACK_MAX_HOLDS
        ) {
            const oldest = this.catchupFallbackUntil.keys().next().value;
            if (oldest === undefined) break;
            this.catchupFallbackUntil.delete(oldest);
        }
    }

    private async probeCatchupUrl(
        url: string,
        credentials: XtreamCredentials
    ): Promise<number> {
        const probeUrl = (window.electron as XtreamProbeApi | undefined)
            ?.probeStreamUrl;

        if (typeof probeUrl !== 'function') {
            return 0;
        }

        try {
            // Probe the way playback requests: a panel that requires the
            // playlist's headers refuses a bare request.
            const result = await probeUrl(url, 'GET', {
                userAgent: credentials.userAgent?.trim() || null,
                referer: credentials.referrer?.trim() || null,
                origin: credentials.origin?.trim() || null,
            });
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

    /**
     * The panel reads the start segment with `strtotime()` in its own
     * timezone, so the epoch is rendered in the timezone the account info
     * reported (IANA name or clock-derived `UTC±HH:MM`,
     * `xtream-server-timezone.util.ts`). Without one, the viewer's local
     * clock is the only remaining guess.
     */
    private formatCatchupStartTime(
        timestamp: number,
        timezone?: string
    ): string {
        return formatXtreamCatchupStart(timestamp, timezone);
    }
}
