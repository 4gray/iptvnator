import { DataService } from '@iptvnator/services';
import {
    isStalkerStreamCredentialSafe,
    PlaylistMeta,
    StalkerPortalActions,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerContentType } from '../stalker-store.contracts';
import {
    resolveStalkerStaticPlaybackUrl,
    type StalkerLinkFlagSource,
} from './stalker-link-semantics.utils';
import { resolveStalkerPlaybackUrl } from './stalker-playback-command.utils';
import {
    ensureStalkerSession,
    executeStalkerRequest,
    type StalkerPortalRepairApi,
} from './stalker-request.utils';

export interface StalkerPlayerResponse {
    js?: {
        error?: string;
        cmd?: string;
        data?: Array<{ id?: string | number }>;
        account_info?: {
            expire_date?: string | number;
        };
    };
}

export interface StalkerPlayerRequestDeps {
    dataService: DataService;
    stalkerSession: StalkerSessionService;
    portalRepair?: StalkerPortalRepairApi;
}

export interface StalkerPlayableItemLike
    extends StalkerPortalItem,
        StalkerLinkFlagSource {
    cmd?: string;
    has_files?: unknown;
}

export async function fetchStalkerPlaybackLink(
    deps: StalkerPlayerRequestDeps,
    options: {
        playlist: PlaylistMeta;
        selectedContentType: StalkerContentType;
        cmd: string;
        series?: number;
        forcedContentType?: StalkerContentType;
        /**
         * The catalog row this `cmd` came from. Without it every playback
         * mints a temporary link; with it, rows that set neither
         * `use_http_tmp_link` nor `use_load_balancing` play their static
         * `cmd` and never touch the portal.
         */
        linkFlags?: StalkerLinkFlagSource | null;
    }
): Promise<string> {
    // An episode is selected server-side by the `series` parameter, so a
    // series request has no static answer even when the parent row is
    // unflagged — the static `cmd` addresses the series, not the episode.
    if (options.series === undefined) {
        const staticUrl = resolveStalkerStaticPlaybackUrl(
            options.linkFlags,
            options.cmd
        );
        if (staticUrl) {
            // Returning here skips the request that used to authenticate.
            // Not every caller has a warm session: the global collection
            // detail sets the playlist and the item straight from a persisted
            // row, with no catalog load in between, so a VOD opened from
            // Favorites on a cold start would play a same-host gated stream
            // without a Bearer token. Warming at this single choke point
            // covers ITV, VOD, radio and downloads alike.
            // Classify BEFORE authenticating. A stream on a foreign host never
            // needs the portal session, and warming it anyway would block
            // playback behind a handshake worth up to 15 s per request against
            // a slow or offline portal (`stalker.events.ts`) for a result that
            // is then discarded — the CDN is reachable even when the portal is
            // not.
            if (
                !isStalkerStreamCredentialSafe(
                    options.playlist.portalUrl ?? '',
                    staticUrl
                )
            ) {
                return staticUrl;
            }

            // Portal-owned: it may be gated on the Bearer token, and minting
            // the link used to be what established the session. Without a
            // usable one, serving this would be serving a known 401 — fall
            // back to the request path instead, which both mints a URL that
            // carries its own token and is the only path that can observe a
            // failure and trigger the lazy portal repair.
            if (await ensureStalkerSession(deps, options.playlist)) {
                return staticUrl;
            }
        }
    }

    const contentType =
        options.forcedContentType ?? options.selectedContentType;
    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        options.playlist,
        {
            action: StalkerContentTypes[contentType].getLink,
            cmd: options.cmd,
            type: options.series ? 'vod' : contentType,
            disable_ad: '0',
            download: '0',
            JsHttpRequest: '1-xml',
            ...(options.series ? { series: String(options.series) } : {}),
        }
    );

    if (response.js?.error) {
        throw new Error(response.js.error);
    }

    // Applied AFTER the request on purpose: a lazy repair may have moved
    // the endpoint during this very call, and a relative `js.cmd`
    // (`/media/...`) must resolve against the endpoint that actually
    // answered — not the activation-time snapshot in options.playlist.
    const effectivePlaylist = deps.portalRepair
        ? deps.portalRepair.applyOverride(options.playlist)
        : options.playlist;

    const streamUrl = resolveStalkerPlaybackUrl(
        effectivePlaylist.portalUrl ?? '',
        options.cmd,
        response.js?.cmd ?? ''
    );

    if (!streamUrl) {
        throw new Error('nothing_to_play');
    }

    return streamUrl;
}

export async function fetchStalkerMovieFileId(
    deps: StalkerPlayerRequestDeps,
    playlist: PlaylistMeta,
    movieId: string
): Promise<string | null> {
    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        playlist,
        {
            action: StalkerPortalActions.GetOrderedList,
            type: 'vod',
            movie_id: movieId,
            p: '1',
        }
    );

    const fileId = response?.js?.data?.[0]?.id;
    return fileId == null ? null : String(fileId);
}

export async function fetchStalkerExpireDate(
    deps: StalkerPlayerRequestDeps,
    playlist: PlaylistMeta
): Promise<string> {
    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        playlist,
        {
            type: 'account_info',
            action: 'get_main_info',
            JsHttpRequest: '1-xml',
        }
    );

    const expireDate = response?.js?.account_info?.expire_date;
    const numericExpireDate = Number(expireDate);

    if (expireDate && !Number.isNaN(numericExpireDate)) {
        return new Date(numericExpireDate * 1000).toLocaleDateString();
    }

    return expireDate ? String(expireDate) : 'Unknown';
}
