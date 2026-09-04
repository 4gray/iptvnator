import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
    Channel,
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
    isFullStalkerPortalPlaylist,
    Playlist,
    isStalkerStreamCredentialSafe,
    ResolvedPortalPlayback,
    shortEpgWindowSize,
    STALKER_REQUEST,
    StalkerPortalActions,
    windowEpgItemsAtProviderClock,
} from '@iptvnator/shared/interfaces';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    buildStalkerExternalPlaybackHeaders,
    ensureStalkerSession,
    executeStalkerRequest,
    getStalkerPortalOrigin,
    hasStalkerLinkFlagEvidence,
    isCrossOriginStalkerStream,
    resolveStalkerPlaybackUrl,
    resolveStalkerStaticPlaybackUrl,
    StalkerPortalRepairService,
    StalkerSessionService,
    type StalkerLinkFlagSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    UnifiedCollectionItem,
    createLogger,
} from '@iptvnator/portal/shared/util';

type PlaylistWithChannels = Playlist & {
    readonly playlist?: { readonly items?: Channel[] };
};

interface StalkerCreateLinkResponse {
    readonly js?: { readonly cmd?: string };
}

interface StalkerEpgEntry {
    readonly id?: string | number;
    readonly name?: string;
    readonly descr?: string;
    readonly time?: string;
    readonly time_to?: string;
    readonly ch_id?: string | number;
    readonly start_timestamp?: string | number;
    readonly stop_timestamp?: string | number;
}

interface StalkerEpgResponse {
    readonly js?: StalkerEpgEntry[] | { readonly data?: StalkerEpgEntry[] };
}

interface XtreamEpgCacheEntry {
    readonly data: EpgItem[];
    readonly timestamp: number;
}

export interface ResolvedLiveCollectionDetail {
    readonly playback: ResolvedPortalPlayback;
    readonly epgMode: 'm3u' | 'portal';
    readonly channel?: Channel;
    readonly epgPrograms?: EpgProgram[];
    readonly epgItems?: EpgItem[];
}

@Injectable({ providedIn: 'root' })
export class StreamResolverService {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly xtreamApi = inject(XtreamApiService);
    private readonly xtreamUrl = inject(XtreamUrlService);
    private readonly dataService = inject(DataService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly portalRepair = inject(StalkerPortalRepairService);
    private readonly logger = createLogger('StreamResolver');
    private readonly m3uEpgTimeoutMs = 3000;
    private readonly portalEpgTimeoutMs = 10000;
    private readonly xtreamEpgCache = new Map<string, XtreamEpgCacheEntry>();
    private readonly xtreamEpgFailureTimestamps = new Map<string, number>();
    private readonly xtreamEpgCacheTtlMs = 60 * 1000;
    private readonly xtreamEpgFailureCooldownMs = 30 * 1000;

    private get supportsProgramLookup(): boolean {
        return this.epgBridge.supportsProgramLookup;
    }

    private async getElectronPlaylist(
        playlistId: string
    ): Promise<Playlist | undefined> {
        if (typeof window === 'undefined') {
            return undefined;
        }

        try {
            return (
                (await window.electron?.dbGetAppPlaylist?.(playlistId)) ??
                undefined
            );
        } catch {
            return undefined;
        }
    }

    async resolvePlayback(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        if (item.sourceType === 'm3u') {
            return (await this.resolveM3uPlaybackDetail(item)).playback;
        }

        return (await this.resolveLiveDetail(item)).playback;
    }

    async resolveLiveDetail(
        item: UnifiedCollectionItem
    ): Promise<ResolvedLiveCollectionDetail> {
        switch (item.sourceType) {
            case 'm3u':
                return this.resolveM3uDetail(item);
            case 'xtream':
                return this.resolveXtreamDetail(item);
            case 'stalker':
                return this.resolveStalkerDetail(item);
        }
    }

    async resolveM3uPlaybackDetail(
        item: UnifiedCollectionItem
    ): Promise<ResolvedLiveCollectionDetail> {
        return this.buildM3uDetail(item, false);
    }

    async loadM3uProgramsForItem(
        item: UnifiedCollectionItem,
        channel?: Channel
    ): Promise<EpgProgram[]> {
        const epgLookupKey = channel
            ? this.getM3uEpgLookupKey(channel, item)
            : await this.getM3uEpgLookupKeyForItem(item);

        return this.fetchM3uPrograms(epgLookupKey);
    }

    async loadEpgItems(item: UnifiedCollectionItem): Promise<EpgItem[]> {
        const detail = await this.resolveLiveDetail(item);
        if (detail.epgItems) {
            return detail.epgItems;
        }

        return this.mapProgramsToEpgItems(detail.epgPrograms ?? []);
    }

    async loadEpgForItems(
        items: UnifiedCollectionItem[]
    ): Promise<Map<string, EpgProgram | null>> {
        const epgMap = new Map<string, EpgProgram | null>();
        if (!this.supportsProgramLookup) {
            return epgMap;
        }

        // One wall-clock instant for the whole load, and "now" in the
        // provider's EPG clock derived from it (`epg-display-offset.util.ts`,
        // clock form): the rows stay raw and the list shifts them for
        // display. Windows cut from a full guide use the same instant, so a
        // programme boundary crossed while a request is on the wire cannot
        // drop the entry the selection below is looking for.
        const wallNowMs = Date.now();
        const now = epgProviderClockMs(
            wallNowMs,
            this.settingsStore.resolvedEpgOffsetMinutes()
        );
        const xtreamByPlaylist = new Map<string, UnifiedCollectionItem[]>();
        const stalkerByPlaylist = new Map<string, UnifiedCollectionItem[]>();

        for (const item of items) {
            if (item.contentType !== 'live') {
                continue;
            }

            if (item.radio === 'true') {
                continue;
            }

            if (item.sourceType === 'xtream') {
                const list = xtreamByPlaylist.get(item.playlistId) ?? [];
                list.push(item);
                xtreamByPlaylist.set(item.playlistId, list);
                continue;
            }

            if (item.sourceType === 'stalker') {
                const list = stalkerByPlaylist.get(item.playlistId) ?? [];
                list.push(item);
                stalkerByPlaylist.set(item.playlistId, list);
                continue;
            }
        }

        const tasks: Promise<void>[] = [];

        for (const item of items) {
            if (item.sourceType === 'm3u' && item.contentType === 'live') {
                tasks.push(this.loadM3uEpg(item, epgMap, now));
            }
        }

        for (const [playlistId, playlistItems] of xtreamByPlaylist.entries()) {
            tasks.push(
                this.loadXtreamEpgBatch(
                    playlistId,
                    playlistItems,
                    epgMap,
                    now,
                    wallNowMs
                )
            );
        }

        for (const [playlistId, playlistItems] of stalkerByPlaylist.entries()) {
            tasks.push(
                this.loadStalkerEpgBatch(playlistId, playlistItems, epgMap, now)
            );
        }

        await Promise.all(tasks.map((task) => task.catch(() => null)));
        return epgMap;
    }

    private async resolveM3uDetail(
        item: UnifiedCollectionItem
    ): Promise<ResolvedLiveCollectionDetail> {
        return this.buildM3uDetail(item, true);
    }

    private async resolveXtreamDetail(
        item: UnifiedCollectionItem
    ): Promise<ResolvedLiveCollectionDetail> {
        const playback = await this.resolveXtream(item);
        if (!this.supportsProgramLookup) {
            return {
                playback,
                epgMode: 'portal',
                epgItems: [],
            };
        }

        const epgItems = await this.withFallbackTimeout(
            this.loadXtreamEpgItems(item),
            this.portalEpgTimeoutMs,
            []
        );

        return {
            playback,
            epgMode: 'portal',
            epgItems,
        };
    }

    private async resolveStalkerDetail(
        item: UnifiedCollectionItem
    ): Promise<ResolvedLiveCollectionDetail> {
        const playback = await this.resolveStalker(item);
        if (item.radio === 'true') {
            return {
                playback,
                epgMode: 'portal',
                channel: this.buildStalkerRadioChannel(item, playback),
                epgItems: [],
            };
        }

        if (!this.supportsProgramLookup) {
            return {
                playback,
                epgMode: 'portal',
                epgItems: [],
            };
        }

        const epgItems = await this.withFallbackTimeout(
            this.loadStalkerEpgItems(item, 10),
            this.portalEpgTimeoutMs,
            []
        );

        return {
            playback,
            epgMode: 'portal',
            epgItems,
        };
    }

    private buildM3uPlayback(
        channel: Channel,
        playlist?: Playlist
    ): ResolvedPortalPlayback {
        const userAgent =
            channel.http?.['user-agent']?.trim() || playlist?.userAgent;
        const referer = channel.http?.referrer?.trim() || playlist?.referrer;
        const origin = channel.http?.origin?.trim() || playlist?.origin;
        const headers: Record<string, string> = {};
        if (userAgent) {
            headers['User-Agent'] = userAgent;
        }
        if (referer) {
            headers['Referer'] = referer;
        }
        if (origin) {
            headers['Origin'] = origin;
        }

        return {
            streamUrl: channel.url ?? '',
            title: channel.name,
            thumbnail: channel.tvg?.logo ?? null,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            userAgent,
            referer,
            origin,
        };
    }

    private async resolveXtream(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        const creds = await this.getXtreamCredentials(item.playlistId);
        if (!creds || item.xtreamId == null) {
            throw new Error('Missing Xtream credentials');
        }

        const streamUrl = this.xtreamUrl.constructLiveUrl(creds, item.xtreamId);

        return {
            streamUrl,
            title: item.name,
            thumbnail: item.logo ?? null,
            isLive: true,
        };
    }

    private async resolveStalker(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as Playlist | undefined;
        // The playlist row wins whenever it exists: a repaired endpoint or an
        // edited MAC must beat the snapshot a favorite persisted, and the
        // session token is negotiated for the ROW's identity — pairing a fresh
        // token with a stale MAC cookie is exactly the mismatch the identity
        // fingerprint exists to prevent. The item's own coordinates are the
        // fallback for a playlist that no longer exists.
        const currentPlaylist = playlist
            ? this.portalRepair.applyOverride(playlist)
            : undefined;
        const portalUrl =
            currentPlaylist?.portalUrl ??
            currentPlaylist?.url ??
            item.stalkerPortalUrl ??
            '';
        const macAddress =
            currentPlaylist?.macAddress ?? item.stalkerMacAddress ?? '';
        // Favorites and Recently Viewed persist the raw catalog row, so the
        // temporary-link flags travel with the item and this route makes the
        // same decision the portal views make: an unflagged, directly playable
        // `cmd` plays as-is and never mints a 5 s link. An item that carries
        // no row snapshot (router state holds only the projection) gets no
        // verdict — except radio, whose directly usable commands have always
        // played as-is, so it keeps behaving like a row without flags.
        const snapshot = item.stalkerItem as StalkerLinkFlagSource | undefined;
        // Radio keeps its historical rule: a directly usable command plays as
        // as-is. That has to key off flag EVIDENCE, not merely a present
        // snapshot — a radio row persisted before the flags were carried has a
        // snapshot that lacks them, and testing presence alone would skip this
        // fallback and start minting for exactly those rows. Mirrors
        // `withStalkerPlayer`'s radio branch; the two must not drift.
        const linkFlags =
            item.radio === 'true' && !hasStalkerLinkFlagEvidence(snapshot)
                ? {
                      ...(snapshot ?? {}),
                      use_http_tmp_link: '0',
                      use_load_balancing: '0',
                  }
                : snapshot;
        const staticUrl = resolveStalkerStaticPlaybackUrl(
            linkFlags,
            item.stalkerCmd ?? ''
        );
        if (staticUrl) {
            // Skipping `create_link` also skips the only authenticated
            // request this route used to make, and it was what warmed the
            // session. Tokens live in memory only, so on a cold start from
            // global Favorites/Recently Viewed a same-host stream gated on
            // the portal Bearer token would get headers without one and 403.
            // `ensureToken` performs the handshake + get_profile — and
            // validates the identity the cached token was negotiated for,
            // which the raw `getCachedToken` below cannot — without minting a
            // link; a simple portal returns null immediately. The raw row goes
            // in: the helper applies the repair override itself, exactly as
            // `executeStalkerRequest` does on the branch below.
            //
            // Classified BEFORE authenticating: a foreign-host stream never
            // needs the session, and warming it anyway would stall playback
            // behind a handshake against a portal that may be slow or offline
            // while the CDN is perfectly reachable.
            const servePlayback = () =>
                this.buildStalkerPlayback(item, playlist, {
                    macAddress,
                    portalUrl,
                    streamUrl: staticUrl,
                    isLive: item.radio === 'true' ? undefined : true,
                });

            if (!isStalkerStreamCredentialSafe(portalUrl, staticUrl)) {
                return servePlayback();
            }

            // Portal-owned with no usable session would be served knowing it
            // will 401, so fall through to `create_link` instead — it mints a
            // URL that carries its own token and is the only path that can
            // observe a failure and trigger the lazy portal repair.
            if (await this.warmStalkerSession(playlist)) {
                return servePlayback();
            }
        }

        const contentType = item.radio === 'true' ? 'radio' : 'itv';
        const params = {
            action: StalkerPortalActions.CreateLink,
            cmd: item.stalkerCmd ?? '',
            type: contentType,
            disable_ad: '0',
            download: '0',
            JsHttpRequest: '1-xml',
        };

        let response: StalkerCreateLinkResponse | undefined;
        // Items opened from global collections can carry their own portal
        // coordinates with no playlist row; only a playlist-backed request
        // can go through the shared mode routing + lazy portal repair. When
        // the row exists it wins over the item's snapshot of the portal URL
        // (a repaired endpoint must beat a stale favorite).
        if (playlist) {
            response = await executeStalkerRequest<StalkerCreateLinkResponse>(
                {
                    dataService: this.dataService,
                    stalkerSession: this.stalkerSession,
                    portalRepair: this.portalRepair,
                },
                playlist,
                params
            );
        } else {
            response = await this.dataService.sendIpcEvent(STALKER_REQUEST, {
                url: portalUrl,
                macAddress,
                params,
            });
        }

        const rawCmd = response?.js?.cmd ?? '';

        // Re-read the override AFTER the request: a lazy repair may have
        // moved the endpoint during this very call, and both the relative
        // `js.cmd` resolution and the playback header origin must follow
        // the endpoint that actually answered.
        const effectivePortalUrl = playlist
            ? (this.portalRepair.applyOverride(playlist).portalUrl ?? portalUrl)
            : portalUrl;

        return this.buildStalkerPlayback(item, playlist, {
            macAddress,
            portalUrl: effectivePortalUrl,
            // Shared normalizer from the Stalker store: strips the solution
            // prefix and resolves relative `/media/...` or `?...` responses
            // against the portal base instead of returning them verbatim.
            streamUrl: resolveStalkerPlaybackUrl(
                effectivePortalUrl,
                item.stalkerCmd ?? '',
                rawCmd
            ),
            isLive: item.radio === 'true' ? undefined : true,
        });
    }

    /**
     * Establish the portal session a static stream may still be gated on.
     * Shares the single primitive with the store's playback path so the two
     * routes cannot drift apart on when a session is required.
     */
    private async warmStalkerSession(
        playlist: Playlist | undefined
    ): Promise<boolean> {
        return ensureStalkerSession(
            {
                dataService: this.dataService,
                stalkerSession: this.stalkerSession,
                portalRepair: this.portalRepair,
            },
            playlist,
            this.logger
        );
    }

    /**
     * The collection routes must hand players the SAME portal header set the
     * Stalker live layout builds — an auth-gated stream opened from Favorites
     * or Recently Viewed 403s without the mac cookie/Bearer token exactly
     * like one opened from the portal itself (the header owner then scopes
     * them to the stream origin; foreign hosts get the credential-free
     * profile from the shared classifier).
     */
    private async buildStalkerPlayback(
        item: UnifiedCollectionItem,
        playlist: Playlist | undefined,
        resolved: {
            macAddress: string;
            portalUrl: string;
            streamUrl: string;
            isLive?: boolean;
        }
    ): Promise<ResolvedPortalPlayback> {
        // The item may carry portal/mac overrides for playlists that no
        // longer exist; the builder only reads header-relevant fields.
        //
        // The override is applied to the ROW, not just folded in as the two
        // resolved coordinates: a repair rewrites the portal MODE as well as
        // the URL, and a playlist repaired from simple to full would otherwise
        // keep its stale `isFullStalkerPortal: false` here. The request that
        // just ran adopted a token under the repaired mode, but the mode-aware
        // token resolver below would read the stale flag and hand back none —
        // emitting a same-host gated stream without the Bearer header on the
        // very playback the repair existed to rescue.
        const headerPlaylist = {
            ...(playlist ? this.portalRepair.applyOverride(playlist) : {}),
            macAddress: resolved.macAddress,
            portalUrl: resolved.portalUrl,
        } as Playlist;
        const crossOriginStream = isCrossOriginStalkerStream(
            headerPlaylist,
            resolved.streamUrl
        );
        // Classified before authenticating, for the same reason the static
        // branch classifies first: the header builder gives a foreign host the
        // credential-free profile, so a token obtained here would be discarded
        // — after stalling playback behind a handshake against a portal that
        // may be slow or offline while the CDN is perfectly reachable.
        //
        // When it IS needed, the token is resolved from `headerPlaylist`
        // rather than the row it came from: those are the exact coordinates
        // the headers claim, so the bearer token and the MAC cookie cannot end
        // up bound to a different endpoint than the one they are sent to. A
        // repair override that moved the endpoint is the live case — it
        // reaches `resolved.portalUrl` but not the raw row, and every other
        // session consumer (`ensureStalkerSession`, `executeStalkerRequest`)
        // already authenticates against the override, so this also stops the
        // resolver from keying the session cache differently and re-shaking.
        const token =
            playlist && !crossOriginStream
                ? await this.resolveStalkerPlaybackToken(headerPlaylist)
                : null;
        const headers = buildStalkerExternalPlaybackHeaders(
            headerPlaylist,
            token,
            resolved.streamUrl
        );
        const portalOrigin = getStalkerPortalOrigin(headerPlaylist);

        return {
            streamUrl: resolved.streamUrl,
            title: item.name,
            thumbnail: item.logo ?? null,
            isLive: resolved.isLive,
            headers,
            userAgent: headers['User-Agent'] || playlist?.userAgent,
            referer: crossOriginStream
                ? undefined
                : playlist?.referrer || portalOrigin,
            origin: crossOriginStream
                ? undefined
                : playlist?.origin || portalOrigin,
        };
    }

    /**
     * Resolves the Bearer token a full portal's stream needs.
     *
     * A direct-URL radio favorite skips `create_link` entirely, so on a cold
     * session nothing has authenticated yet and the in-memory cache is empty —
     * a same-host Bearer-gated stream would then 403 in the built-in audio
     * player. `ensureToken()` re-presents the persisted token instead, which
     * is a single idempotent handshake rather than a full re-auth. Failures
     * stay non-fatal: many portals do not gate the stream itself.
     */
    private async resolveStalkerPlaybackToken(
        playlist: Playlist | undefined
    ): Promise<string | null> {
        // The shared mode contract, not the raw flag: a legacy row with an
        // absent flag but a canonical URL IS a full portal, and reading the
        // property directly would skip authentication for it — a restored
        // older backup opens a direct-URL radio favorite with no Bearer.
        if (!playlist || !isFullStalkerPortalPlaylist(playlist)) {
            return null;
        }

        // Always through ensureToken, never the raw cache accessor: that one
        // skips the endpoint/identity/credential check, so after an edit this
        // playback path would put the previous account's token into the
        // stream headers. ensureToken returns the cached token when it is
        // still valid for this playlist, so a warm session costs nothing.
        try {
            const { token } = await this.stalkerSession.ensureToken(playlist);
            return token;
        } catch {
            return null;
        }
    }

    private buildStalkerRadioChannel(
        item: UnifiedCollectionItem,
        playback: ResolvedPortalPlayback
    ): Channel {
        const channelId = String(
            item.stalkerId ?? item.tvgId ?? item.uid.split('::')[2] ?? ''
        );

        return {
            id: channelId,
            name: item.name,
            url: playback.streamUrl,
            tvg: {
                id: item.tvgId ?? channelId,
                name: item.name,
                url: '',
                logo: item.logo ?? playback.thumbnail ?? '',
                rec: '',
            },
            group: { title: '' },
            http: {
                referrer: playback.referer ?? '',
                'user-agent': playback.userAgent ?? '',
                origin: playback.origin ?? '',
            },
            radio: 'true',
            epgParams: '',
        };
    }

    private async loadXtreamEpgItems(
        item: UnifiedCollectionItem
    ): Promise<EpgItem[]> {
        try {
            if (item.xtreamId == null) {
                return [];
            }

            const creds = await this.getXtreamCredentials(item.playlistId);
            if (!creds) {
                return [];
            }

            // 1) Check uploaded XMLTV EPG via the provider's epg_channel_id.
            // The field is populated at runtime from the content table's
            // epg_channel_id column but is not declared on the TS interface.
            const epgKey = (
                item as unknown as Record<string, string | undefined | null>
            ).epgChannelId?.trim();
            if (this.supportsProgramLookup && epgKey) {
                const uploaded = await this.epgBridge
                    .getChannelPrograms(epgKey)
                    .catch(() => null);
                if (uploaded && uploaded.length > 0) {
                    return this.mapProgramsToEpgItems(uploaded);
                }
            }

            // 2) Fall back to the manual mapping table (playlist-scoped
            // Xtream key → epgChannelId).
            if (this.supportsProgramLookup && item.xtreamId) {
                const mapping = await this.epgBridge
                    .getEpgMapping(
                        buildXtreamEpgMappingKey(item.playlistId, item.xtreamId)
                    )
                    .catch(() => null);
                if (mapping?.epgChannelId) {
                    const mapped = await this.epgBridge
                        .getChannelPrograms(mapping.epgChannelId)
                        .catch(() => null);
                    if (mapped && mapped.length > 0) {
                        return this.mapProgramsToEpgItems(mapped);
                    }
                }
            }

            // 3) Try the full EPG endpoint (same as the main live-view
            // loadEpg() in with-epg.feature.ts) — many providers only
            // support get_simple_data_table, not get_short_epg.
            try {
                const fullEpg = await this.xtreamApi.getFullEpg(
                    creds,
                    item.xtreamId,
                    { suppressErrorLog: true }
                );
                if (fullEpg.length > 0) {
                    return fullEpg;
                }
            } catch {
                // getFullEpg failed — continue to short-EPG fallback below.
            }

            // Fall back to the short-EPG endpoint with a generous limit.
            return await this.fetchXtreamEpgItems(
                item.playlistId,
                creds,
                item.xtreamId,
                50
            );
        } catch {
            return [];
        }
    }

    private async loadStalkerEpgItems(
        item: UnifiedCollectionItem,
        size: number
    ): Promise<EpgItem[]> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as Playlist | undefined;
        const channelId = String(
            item.stalkerId ??
                (item.stalkerItem as Record<string, unknown> | undefined)?.[
                    'id'
                ] ??
                ''
        ).trim();

        if (!playlist || !channelId) {
            return [];
        }

        // Manual mapping first — Stalker items carry no provider XMLTV id,
        // so the mapping table is the only uploaded-EPG entry point.
        if (this.supportsProgramLookup) {
            const mapping = await this.epgBridge
                .getEpgMapping(
                    buildStalkerEpgMappingKey(item.playlistId, channelId)
                )
                .catch(() => null);
            if (mapping?.epgChannelId) {
                const mapped = await this.epgBridge
                    .getChannelPrograms(mapping.epgChannelId)
                    .catch(() => null);
                if (mapped && mapped.length > 0) {
                    return this.mapProgramsToEpgItems(mapped);
                }
            }
        }

        // Widened under a negative display offset so the window still reaches
        // the programme on air (`shortEpgWindowSize`).
        return this.fetchStalkerShortEpg(
            playlist,
            channelId,
            shortEpgWindowSize(
                this.settingsStore.resolvedEpgOffsetMinutes(),
                size
            )
        );
    }

    private async getXtreamCredentials(playlistId: string): Promise<{
        serverUrl: string;
        username: string;
        password: string;
        serverTimezone?: string;
    } | null> {
        const playlist =
            (await this.getElectronPlaylist(playlistId)) ??
            ((await firstValueFrom(
                this.playlistsService.getPlaylistById(playlistId)
            )) as Playlist | undefined);

        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            return null;
        }

        return {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            serverTimezone: playlist.serverTimezone,
        };
    }

    /**
     * Resolve an Xtream archive/catch-up URL for a given programme.
     * Returns the timeshift playback URL, or null when credentials are
     * missing or the provider doesn't support it.
     */
    async resolveXtreamCatchupUrl(
        item: UnifiedCollectionItem,
        startTimestamp: number,
        stopTimestamp: number
    ): Promise<string | null> {
        const creds = await this.getXtreamCredentials(item.playlistId);
        if (!creds || !item.xtreamId) return null;

        try {
            return await this.xtreamUrl.resolveCatchupUrl(
                item.playlistId,
                creds,
                item.xtreamId,
                startTimestamp,
                stopTimestamp,
                creds.serverTimezone
            );
        } catch {
            return null;
        }
    }

    private async loadM3uEpg(
        item: UnifiedCollectionItem,
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        const epgLookupKey = item.tvgId?.trim() || item.name?.trim();
        if (!epgLookupKey) {
            return;
        }

        const programs = await this.fetchM3uPrograms(epgLookupKey);
        epgMap.set(epgLookupKey, this.findCurrentProgram(programs, now));
    }

    private async buildM3uDetail(
        item: UnifiedCollectionItem,
        includePrograms: boolean
    ): Promise<ResolvedLiveCollectionDetail> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as PlaylistWithChannels | undefined;
        const channel =
            this.findM3uChannel(playlist?.playlist?.items ?? [], item) ??
            this.buildFallbackM3uChannel(item);
        const epgPrograms =
            includePrograms && this.supportsProgramLookup
                ? await this.fetchM3uPrograms(
                      this.getM3uEpgLookupKey(channel, item)
                  )
                : [];

        return {
            playback: this.buildM3uPlayback(channel, playlist),
            epgMode: 'm3u',
            channel,
            epgPrograms,
        };
    }

    private async getM3uEpgLookupKeyForItem(
        item: UnifiedCollectionItem
    ): Promise<string | null> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as PlaylistWithChannels | undefined;
        const channel =
            this.findM3uChannel(playlist?.playlist?.items ?? [], item) ??
            this.buildFallbackM3uChannel(item);

        return this.getM3uEpgLookupKey(channel, item);
    }

    private async fetchM3uPrograms(
        epgLookupKey?: string | null
    ): Promise<EpgProgram[]> {
        if (!this.epgBridge.supportsProgramLookup || !epgLookupKey) {
            return [];
        }

        return this.withFallbackTimeout(
            this.epgBridge
                .getChannelPrograms(epgLookupKey)
                .then((programs) => programs ?? []),
            this.m3uEpgTimeoutMs,
            []
        );
    }

    private async withFallbackTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        fallback: T
    ): Promise<T> {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => resolve(fallback), timeoutMs);

            promise
                .then((value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                })
                .catch(() => {
                    clearTimeout(timeoutId);
                    resolve(fallback);
                });
        });
    }

    private async loadXtreamEpgBatch(
        playlistId: string,
        channels: UnifiedCollectionItem[],
        epgMap: Map<string, EpgProgram | null>,
        now: number,
        wallNowMs: number
    ): Promise<void> {
        const creds = await this.getXtreamCredentials(playlistId);
        if (!creds) {
            return;
        }

        // Prefetch manual EPG mappings for the whole batch in one IPC
        // round-trip — a per-channel lookup would issue O(N × candidates)
        // IPC calls on every list load.
        const mappingByKey = await this.prefetchEpgMappings(
            playlistId,
            channels
        );

        // Limit concurrency to avoid overwhelming the provider with
        // simultaneous EPG requests when loading a large channel list.
        const concurrency = 3;
        const pending: Promise<void>[] = [];
        const iterator = channels.entries();

        const enqueueNext = async (): Promise<void> => {
            for (;;) {
                const entry = iterator.next();
                if (entry.done) return;
                const [, channel] = entry.value;
                if (!channel.xtreamId) continue;

                try {
                    const nowSeconds = Math.floor(now / 1000);
                    let currentItem: EpgItem | null = null;

                    // 1) Try uploaded XMLTV EPG via the provider's epg_channel_id.
                    const epgChannelKey = (
                        channel as unknown as Record<
                            string,
                            string | undefined | null
                        >
                    ).epgChannelId?.trim();
                    if (this.supportsProgramLookup && epgChannelKey) {
                        currentItem = await this.findCurrentInXmltv(
                            epgChannelKey,
                            nowSeconds
                        );
                    }

                    // 2) Fall back to manual mapping (epg_channel_mappings
                    // table), using the batch-prefetched map. Candidate key
                    // order matches how mappings can be saved: the
                    // playlist-scoped Xtream key (portal/favorites dialogs),
                    // then tvgId and name (M3U dialogs).
                    if (!currentItem && this.supportsProgramLookup) {
                        for (const key of this.mappingCandidateKeys(
                            playlistId,
                            channel
                        )) {
                            const mappedId = mappingByKey.get(key);
                            if (!mappedId) continue;
                            currentItem = await this.findCurrentInXmltv(
                                mappedId,
                                nowSeconds
                            );
                            if (currentItem) break;
                        }
                    }

                    if (!currentItem) {
                        const items = await this.fetchXtreamEpgItems(
                            playlistId,
                            creds,
                            channel.xtreamId,
                            5,
                            wallNowMs
                        );
                        currentItem =
                            items.find(
                                (item) =>
                                    Number(item.start_timestamp) <=
                                        nowSeconds &&
                                    nowSeconds < Number(item.stop_timestamp)
                            ) ?? null;
                    }
                    const epgKey =
                        channel.tvgId?.trim() || channel.name?.trim();

                    if (!epgKey) {
                        continue;
                    }

                    epgMap.set(
                        epgKey,
                        currentItem
                            ? {
                                  start: new Date(
                                      Number(currentItem.start_timestamp) * 1000
                                  ).toISOString(),
                                  stop: new Date(
                                      Number(currentItem.stop_timestamp) * 1000
                                  ).toISOString(),
                                  channel: String(channel.xtreamId),
                                  title: currentItem.title,
                                  desc: currentItem.description ?? null,
                                  category: null,
                              }
                            : null
                    );
                } catch {
                    const epgKey =
                        channel.tvgId?.trim() || channel.name?.trim();
                    if (epgKey) {
                        epgMap.set(epgKey, null);
                    }
                }
            }
        };

        // Start limited concurrent workers.
        for (let i = 0; i < concurrency; i++) {
            pending.push(enqueueNext());
        }
        await Promise.all(pending);
    }

    private getXtreamEpgCacheKey(
        playlistId: string,
        streamId: number,
        limit: number,
        offsetMinutes: number
    ): string {
        // A window cut at another provider clock answers a different question.
        return `${playlistId}:${streamId}:${limit}:${offsetMinutes}`;
    }

    private getCachedXtreamEpgItems(cacheKey: string): EpgItem[] | null {
        const entry = this.xtreamEpgCache.get(cacheKey);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.timestamp > this.xtreamEpgCacheTtlMs) {
            this.xtreamEpgCache.delete(cacheKey);
            return null;
        }

        return entry.data;
    }

    private isXtreamEpgFailureCoolingDown(cacheKey: string): boolean {
        const timestamp = this.xtreamEpgFailureTimestamps.get(cacheKey);
        if (timestamp == null) {
            return false;
        }

        if (Date.now() - timestamp > this.xtreamEpgFailureCooldownMs) {
            this.xtreamEpgFailureTimestamps.delete(cacheKey);
            return false;
        }

        return true;
    }

    private async fetchXtreamEpgItems(
        playlistId: string,
        credentials: {
            serverUrl: string;
            username: string;
            password: string;
        },
        streamId: number,
        limit: number,
        wallNowMs = Date.now()
    ): Promise<EpgItem[]> {
        if (!this.supportsProgramLookup) {
            return [];
        }

        const offsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes();
        const cacheKey = this.getXtreamEpgCacheKey(
            playlistId,
            streamId,
            limit,
            offsetMinutes
        );
        const cached = this.getCachedXtreamEpgItems(cacheKey);
        if (cached !== null) {
            return cached;
        }

        if (this.isXtreamEpgFailureCoolingDown(cacheKey)) {
            return [];
        }

        try {
            // get_short_epg starts at the provider's own "now" and cannot
            // reach the programme on air under a display offset, so the
            // same window is cut from the full guide at the provider clock
            // instead (`epg-display-offset.util.ts`).
            const items =
                offsetMinutes === 0
                    ? await this.xtreamApi.getShortEpg(
                          credentials,
                          streamId,
                          limit,
                          { suppressErrorLog: true }
                      )
                    : windowEpgItemsAtProviderClock(
                          await this.xtreamApi.getFullEpg(
                              credentials,
                              streamId,
                              { suppressErrorLog: true }
                          ),
                          offsetMinutes,
                          limit,
                          wallNowMs
                      );

            this.xtreamEpgCache.set(cacheKey, {
                data: items,
                timestamp: Date.now(),
            });
            this.xtreamEpgFailureTimestamps.delete(cacheKey);
            return items;
        } catch {
            this.xtreamEpgFailureTimestamps.set(cacheKey, Date.now());
            return [];
        }
    }

    private async loadStalkerEpgBatch(
        playlistId: string,
        channels: UnifiedCollectionItem[],
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(playlistId)
        )) as Playlist | undefined;

        if (!playlist) {
            return;
        }

        // One batched IPC round-trip for the manual mappings of the whole
        // playlist batch — mirrors loadXtreamEpgBatch.
        const mappingByKey = await this.prefetchEpgMappings(
            playlistId,
            channels
        );
        const nowSeconds = Math.floor(now / 1000);

        await Promise.all(
            channels.map(async (channel) => {
                const channelId = String(channel.stalkerId ?? '').trim();
                const epgKey =
                    channel.tvgId?.trim() || channelId || channel.name?.trim();

                if (!channelId || !epgKey) {
                    return;
                }

                try {
                    for (const key of this.mappingCandidateKeys(
                        playlistId,
                        channel
                    )) {
                        const mappedId = mappingByKey.get(key);
                        if (!mappedId) continue;
                        const mappedItem = await this.findCurrentInXmltv(
                            mappedId,
                            nowSeconds
                        );
                        if (mappedItem) {
                            epgMap.set(
                                epgKey,
                                this.toPreviewProgram(
                                    mappedItem,
                                    channelId,
                                    now
                                )
                            );
                            return;
                        }
                    }

                    // The short EPG starts at the portal's own "now"; under a
                    // negative display offset the programme on air lies
                    // further ahead, so the window is widened and the entry
                    // covering the provider clock is picked, not the first.
                    const items = await this.fetchStalkerShortEpg(
                        playlist,
                        channelId,
                        shortEpgWindowSize(
                            this.settingsStore.resolvedEpgOffsetMinutes(),
                            1
                        )
                    );
                    let preview: EpgProgram | null = null;
                    for (const item of items) {
                        preview = this.toPreviewProgram(item, channelId, now);
                        if (preview) {
                            break;
                        }
                    }
                    epgMap.set(epgKey, preview);
                } catch {
                    epgMap.set(epgKey, null);
                }
            })
        );
    }

    private async fetchStalkerShortEpg(
        playlist: Playlist,
        channelId: string,
        size: number
    ): Promise<EpgItem[]> {
        if (!this.supportsProgramLookup) {
            return [];
        }

        const params = {
            action: StalkerPortalActions.GetShortEpg,
            type: 'itv',
            ch_id: channelId,
            size: String(size),
        };

        const response: StalkerEpgResponse =
            await executeStalkerRequest<StalkerEpgResponse>(
                {
                    dataService: this.dataService,
                    stalkerSession: this.stalkerSession,
                    portalRepair: this.portalRepair,
                },
                playlist,
                params
            );

        const epgData = Array.isArray(response?.js)
            ? response.js
            : (response?.js?.data ?? []);

        return epgData.map((item) => ({
            id: String(item.id ?? ''),
            epg_id: '',
            title: item.name ?? '',
            description: item.descr ?? '',
            lang: '',
            start: item.time ?? '',
            end: item.time_to ?? '',
            stop: item.time_to ?? '',
            channel_id: String(item.ch_id ?? channelId),
            start_timestamp: String(item.start_timestamp ?? ''),
            stop_timestamp: String(item.stop_timestamp ?? ''),
        }));
    }

    private findM3uChannel(
        channels: Channel[],
        item: UnifiedCollectionItem
    ): Channel | undefined {
        return channels.find(
            (channel) =>
                (item.streamUrl && channel.url === item.streamUrl) ||
                (item.channelId && channel.id === item.channelId)
        );
    }

    private buildFallbackM3uChannel(item: UnifiedCollectionItem): Channel {
        return {
            id: item.channelId ?? item.uid.split('::')[2] ?? '',
            name: item.name,
            url: item.streamUrl ?? '',
            tvg: {
                id: item.tvgId ?? '',
                name: item.name,
                url: '',
                logo: item.logo ?? '',
                rec: '',
            },
            group: { title: '' },
            http: {
                referrer: '',
                'user-agent': '',
                origin: '',
            },
            radio: item.radio ?? 'false',
            epgParams: '',
        };
    }

    private getM3uEpgLookupKey(
        channel: Channel | undefined,
        item: UnifiedCollectionItem
    ): string {
        return (
            channel?.tvg?.id?.trim() ||
            item.tvgId?.trim() ||
            channel?.tvg?.name?.trim() ||
            channel?.name?.trim() ||
            item.name?.trim() ||
            ''
        );
    }

    private findCurrentProgram(
        programs: EpgProgram[],
        now: number
    ): EpgProgram | null {
        return (
            programs.find((program) => {
                const start = new Date(program.start).getTime();
                const stop = new Date(program.stop).getTime();
                return start <= now && now < stop;
            }) ?? null
        );
    }

    /**
     * The item as a preview programme, or null when it is not airing at
     * `now`. The window comes from the unix timestamps when the portal sends
     * them and from the ISO boundaries otherwise; an item with no readable
     * boundary at all is accepted as-is (the portal's own "current" entry).
     */
    private toPreviewProgram(
        item: EpgItem,
        channelId: string | number,
        now: number
    ): EpgProgram | null {
        const startMs = epgBoundaryMs(item.start_timestamp, item.start);
        const stopMs = epgBoundaryMs(
            item.stop_timestamp,
            item.stop ?? item.end
        );

        if (
            startMs !== null &&
            stopMs !== null &&
            (now < startMs || now >= stopMs)
        ) {
            return null;
        }

        return {
            start: item.start,
            stop: item.stop || item.end,
            channel: String(channelId),
            title: item.title,
            desc: item.description || null,
            category: null,
        };
    }

    private mapProgramsToEpgItems(programs: EpgProgram[]): EpgItem[] {
        return programs.map((program, index) => ({
            id: String(index),
            epg_id: program.channel,
            title: program.title,
            lang: 'en',
            start: program.start,
            end: program.stop,
            stop: program.stop,
            description: program.desc ?? '',
            channel_id: program.channel,
            start_timestamp: String(
                Math.floor(new Date(program.start).getTime() / 1000)
            ),
            stop_timestamp: String(
                Math.floor(new Date(program.stop).getTime() / 1000)
            ),
        }));
    }

    /**
     * All keys a manual mapping for this channel may have been saved under:
     * the playlist-scoped Xtream key first, then the M3U lookup keys.
     */
    private mappingCandidateKeys(
        playlistId: string,
        channel: UnifiedCollectionItem
    ): string[] {
        // Stalker mappings are only ever saved under the playlist-scoped
        // key, and a stalker item's tvgId mirrors its raw provider id —
        // bare tvgId/name candidates could only produce false matches
        // against unrelated M3U mappings.
        if (channel.sourceType === 'stalker') {
            return channel.stalkerId != null
                ? [buildStalkerEpgMappingKey(playlistId, channel.stalkerId)]
                : [];
        }

        return [
            channel.xtreamId != null
                ? buildXtreamEpgMappingKey(playlistId, channel.xtreamId)
                : null,
            channel.tvgId?.trim() || null,
            channel.name?.trim() || null,
        ].filter((key): key is string => Boolean(key));
    }

    /**
     * Resolve the manual EPG mappings for every candidate key in the batch
     * with a single IPC call. Returns an empty map when program lookup or
     * the mapping bridge is unavailable (PWA).
     */
    private async prefetchEpgMappings(
        playlistId: string,
        channels: UnifiedCollectionItem[]
    ): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        if (!this.supportsProgramLookup) {
            return result;
        }

        const keys = new Set<string>();
        for (const channel of channels) {
            if (channel.xtreamId == null && channel.stalkerId == null) {
                continue;
            }
            for (const key of this.mappingCandidateKeys(playlistId, channel)) {
                keys.add(key);
            }
        }
        if (keys.size === 0) {
            return result;
        }

        const mappings = await this.epgBridge
            .getEpgMappingsBatch([...keys])
            .catch(() => null);
        if (!mappings) {
            return result;
        }
        for (const [key, mappedId] of Object.entries(mappings)) {
            const trimmed = mappedId?.trim();
            if (trimmed) {
                result.set(key, trimmed);
            }
        }
        return result;
    }

    /** Look up the current program for an EPG channel ID from uploaded XMLTV. */
    private async findCurrentInXmltv(
        epgChannelId: string,
        nowSeconds: number
    ): Promise<EpgItem | null> {
        if (!this.supportsProgramLookup || !epgChannelId) return null;
        const programs = await this.epgBridge
            .getChannelPrograms(epgChannelId)
            .catch(() => null);
        if (!programs || programs.length === 0) return null;
        const items = this.mapProgramsToEpgItems(programs);
        return (
            items.find(
                (item) =>
                    Number(item.start_timestamp) <= nowSeconds &&
                    nowSeconds < Number(item.stop_timestamp)
            ) ?? null
        );
    }
}

/** Epoch ms of a portal EPG boundary: unix seconds when present, else the ISO text. */
function epgBoundaryMs(
    timestamp: string | number | null | undefined,
    iso: string | null | undefined
): number | null {
    const seconds = Number(timestamp);
    if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
    }
    const parsed = Date.parse(iso ?? '');
    return Number.isFinite(parsed) ? parsed : null;
}
