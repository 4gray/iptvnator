import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { interval, of, startWith, switchMap } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    EmptyStateComponent,
    PlaylistInfoComponent,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/ui';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspacePlaylistType,
} from '@iptvnator/workspace/shell/util';
import { DialogService } from '@iptvnator/ui/components';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistDeleteActionService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    DashboardDataService,
    DashboardFavoriteItem,
    DashboardRecentlyAddedItem,
    GlobalRecentItem,
} from '@iptvnator/workspace/dashboard/data-access';
import { DashboardRailComponent } from './dashboard-rail.component';
import type {
    DashboardRailAction,
    DashboardRailCard,
    DashboardRailActionSelection,
} from './dashboard-rail.component';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

// Cap dashboard rails at 20 items. Users get ~3× what's visible at once,
// the DOM stays cheap, and the "Manage all" link is one click away for the
// full list. Matches the single-rail density of Netflix / Apple TV+.
const RAIL_ITEM_LIMIT = 20;

// EPG "now" data ticks every 30s — short enough that the progress bar moves
// visibly between long-tail program changes, long enough that we don't hammer
// the SQLite backend with a batched IPC every animation frame. Matches the
// channel-list-container's existing progress cadence so the two surfaces
// can't drift out of sync.
const LIVE_EPG_TICK_MS = 30_000;

// Six placeholder slots per skeleton rail — fills a typical viewport without
// taking the whole page. Mirrors the recently-added skeleton density.
const SKELETON_CARDS_PER_RAIL = [1, 2, 3, 4, 5, 6] as const;
const SKELETON_RAILS = [1, 2, 3] as const;

interface DashboardHeroModel {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly contentType?: 'live' | 'movie' | 'series';
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly icon: string;
    readonly link: string[];
    readonly posterUrl?: string;
    readonly state?: Record<string, unknown>;
    readonly subtitle: string;
    readonly title: string;
    /** 0–100 watched, when a resume position is known. */
    readonly watchProgress?: number | null;
    readonly remainingLabel?: DashboardRemainingLabel | null;
}

export interface DashboardRemainingLabel {
    readonly key: string;
    readonly params: Record<string, number>;
}

export type DashboardHeroBackdropSource = 'backdrop' | 'poster' | 'fallback';

export interface DashboardHeroArtworkInput {
    readonly backdropUrl?: string | null;
    readonly posterUrl?: string | null;
    readonly title: string;
}

export interface DashboardHeroArtwork {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly posterUrl?: string;
}

export function resolveDashboardHeroArtwork(
    item: DashboardHeroArtworkInput,
    failedImages: Record<string, true>
): DashboardHeroArtwork {
    const posterUrl =
        item.posterUrl && !failedImages[item.posterUrl]
            ? item.posterUrl
            : undefined;
    const explicitBackdropUrl =
        item.backdropUrl && !failedImages[item.backdropUrl]
            ? item.backdropUrl
            : undefined;
    const backdropUrl = explicitBackdropUrl ?? posterUrl;
    const backdropSource: DashboardHeroBackdropSource = explicitBackdropUrl
        ? 'backdrop'
        : posterUrl
          ? 'poster'
          : 'fallback';

    return {
        backdropUrl,
        backdropSource,
        fallbackBackdropBackground: buildFallbackBackground(
            item.title,
            50,
            15,
            80,
            5,
            60
        ),
        fallbackPosterBackground: buildFallbackBackground(
            item.title,
            40,
            25,
            50,
            15,
            40
        ),
        hasBackdrop: backdropSource === 'backdrop',
        posterUrl,
    };
}

function buildFallbackBackground(
    title: string,
    saturationA: number,
    lightnessA: number,
    saturationB: number,
    lightnessB: number,
    hueOffset: number
): string {
    const hue = calculateHue(title || 'placeholder');
    const h2 = (hue + hueOffset) % 360;
    return `linear-gradient(135deg, hsl(${hue}, ${saturationA}%, ${lightnessA}%) 0%, hsl(${h2}, ${saturationB}%, ${lightnessB}%) 100%)`;
}

function calculateHue(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    return Math.abs(hash) % 360;
}

export type DashboardSourceActionId =
    | 'refresh'
    | 'playlist-info'
    | 'account-info'
    | 'remove';

export function buildDashboardSourceActions(
    playlist: PlaylistMeta,
    canRefresh: boolean
): DashboardRailAction[] {
    const actions: DashboardRailAction[] = [];

    if (canRefresh) {
        actions.push({
            id: 'refresh',
            icon: 'sync',
            labelKey: playlist.serverUrl
                ? 'HOME.PLAYLISTS.REFRESH_XTREAM'
                : 'HOME.PLAYLISTS.REFRESH',
        });
    }

    actions.push({
        id: 'playlist-info',
        icon: 'edit',
        labelKey: 'HOME.PLAYLISTS.SHOW_DETAILS',
    });

    if (isXtreamAccountPlaylist(playlist)) {
        actions.push({
            id: 'account-info',
            icon: 'person',
            labelKey: 'WORKSPACE.SHELL.ACCOUNT_INFO',
        });
    }

    actions.push({
        id: 'remove',
        icon: 'delete',
        labelKey: 'HOME.PLAYLISTS.REMOVE_DIALOG.TITLE',
        destructive: true,
        separatorBefore: true,
    });

    return actions;
}

// Reads either an ISO `start`/`stop` or the pre-computed `startTimestamp`
// when present (the parsed XMLTV pipeline populates both, but legacy rows
// only carry the strings).
function epgTimestampMs(
    program: EpgProgram,
    side: 'start' | 'stop'
): number | null {
    const cached =
        side === 'start' ? program.startTimestamp : program.stopTimestamp;
    if (cached != null) {
        return cached;
    }
    const iso = side === 'start' ? program.start : program.stop;
    const ms = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
}

function formatEpgTime(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
}

export function formatEpgTimeRange(program: EpgProgram): string | null {
    const start = epgTimestampMs(program, 'start');
    const stop = epgTimestampMs(program, 'stop');
    if (start == null || stop == null) {
        return null;
    }
    return `${formatEpgTime(start)} – ${formatEpgTime(stop)}`;
}

export function calcEpgProgress(
    program: EpgProgram,
    nowMs: number
): number | null {
    const start = epgTimestampMs(program, 'start');
    const stop = epgTimestampMs(program, 'stop');
    if (start == null || stop == null || stop <= start) {
        return null;
    }
    const ratio = (nowMs - start) / (stop - start);
    if (!Number.isFinite(ratio)) {
        return null;
    }
    return Math.max(0, Math.min(100, ratio * 100));
}

function liveEpgLookupKeyForCard(card: DashboardRailCard): string {
    return card.epgLookupKey?.trim() || card.title.trim();
}

export function buildLiveEpgLookupKeys(
    cards: readonly DashboardRailCard[]
): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const card of cards) {
        const key = liveEpgLookupKeyForCard(card);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

export function getLiveEpgProgramForCard(
    card: DashboardRailCard,
    epgMap: ReadonlyMap<string, EpgProgram | null>
): EpgProgram | null {
    const key = liveEpgLookupKeyForCard(card);
    const program = epgMap.get(key);
    if (program) {
        return program;
    }

    const titleKey = card.title.trim();
    return key !== titleKey ? (epgMap.get(titleKey) ?? null) : null;
}

export function liveRailTitleKeyForSource(
    source: 'favorites' | 'recent'
): string {
    return source === 'favorites'
        ? 'WORKSPACE.DASHBOARD.LIVE_FAVORITES'
        : 'WORKSPACE.DASHBOARD.LIVE_RECENT';
}

export function buildPlaybackPositionReloadKey(
    items: readonly Pick<
        GlobalRecentItem,
        'playlist_id' | 'type' | 'xtream_id'
    >[]
): string {
    return items
        .filter((item) => item.type === 'movie' || item.type === 'series')
        .map((item) => `${item.playlist_id}::${item.type}::${item.xtream_id}`)
        .sort()
        .join('|');
}

// ── Playback-position helpers (used by both hero + Continue Watching cards)
// — kept as plain functions so they're easy to unit-test without mounting the
// component or the data service.

export function playbackProgressPercent(
    position: { positionSeconds: number; durationSeconds?: number } | null
): number | null {
    if (
        !position ||
        position.durationSeconds == null ||
        position.durationSeconds <= 0
    ) {
        return null;
    }
    const ratio = position.positionSeconds / position.durationSeconds;
    if (!Number.isFinite(ratio)) {
        return null;
    }
    // Integer percent — keeps "92% watched" out of "92.4% watched" territory,
    // and matches the resolution of a 3px-tall progress bar on a 280px card.
    return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
}

export function formatRemainingLabel(
    position: { positionSeconds: number; durationSeconds?: number } | null
): DashboardRemainingLabel | null {
    if (
        !position ||
        position.durationSeconds == null ||
        position.durationSeconds <= 0
    ) {
        return null;
    }
    const remaining = Math.max(
        0,
        Math.round(position.durationSeconds - position.positionSeconds)
    );
    if (remaining < 60) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_SECONDS',
            params: { seconds: remaining },
        };
    }
    const totalMinutes = Math.round(remaining / 60);
    if (totalMinutes < 60) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
            params: { minutes: totalMinutes },
        };
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS',
            params: { hours },
        };
    }
    return {
        key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS_MINUTES',
        params: { hours, minutes },
    };
}

function isXtreamAccountPlaylist(
    playlist: PlaylistMeta
): playlist is PlaylistMeta & {
    serverUrl: string;
    username: string;
    password: string;
} {
    return Boolean(
        playlist.serverUrl && playlist.username && playlist.password
    );
}

@Component({
    selector: 'lib-workspace-dashboard-rails',
    imports: [
        DashboardRailComponent,
        EmptyStateComponent,
        MatButtonModule,
        MatIcon,
        RouterLink,
        TranslatePipe,
    ],
    templateUrl: './workspace-dashboard-rails.component.html',
    styleUrl: './workspace-dashboard-rails.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.rails-page-host--empty]': 'ready() && !hasPlaylists()',
    },
})
export class WorkspaceDashboardRailsComponent {
    readonly data = inject(DashboardDataService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly playlistDeleteAction = inject(PlaylistDeleteActionService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly epgService = inject(EpgService);
    private readonly runtime = inject(RuntimeCapabilitiesService);

    readonly hasPlaylists = computed(() => this.data.playlists().length > 0);
    readonly ready = this.data.dashboardReady;
    readonly xtreamPlaylistCount = this.data.xtreamPlaylistCount;
    readonly isElectron = this.runtime.isElectron;

    readonly skeletonSlots = SKELETON_CARDS_PER_RAIL;
    readonly skeletonRails = SKELETON_RAILS;
    readonly failedHeroImages = signal<Record<string, true>>({});

    readonly hero = computed<DashboardHeroModel | null>(() => {
        const item = this.data.globalRecentItems()[0] ?? null;
        if (!item) {
            return null;
        }

        const artwork = resolveDashboardHeroArtwork(
            {
                backdropUrl: item.backdrop_url,
                posterUrl: item.poster_url,
                title: item.title,
            },
            this.failedHeroImages()
        );

        const position = this.data.getPlaybackPositionForItem(item);

        return {
            ...artwork,
            contentType: item.type,
            icon: this.typeIcon(item.type),
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
            subtitle: this.buildHeroSubtitle(item),
            title: item.title,
            watchProgress: playbackProgressPercent(position),
            remainingLabel: formatRemainingLabel(position),
        };
    });

    // Split the mixed "recently watched" history into two rails. VOD items
    // (movies/series) get one rail; live channels get their own. Two card
    // formats — one rail each — so users can scan each surface at a glance
    // instead of decoding a mixed grid of fallback posters and channel logos.
    readonly continueWatchingCards = computed<DashboardRailCard[]>(() => {
        this.languageTick();
        return this.data
            .globalRecentVodItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentCard(item));
    });

    // Live rail source — favorited live channels take precedence so the EPG
    // enrichment lands on the channels the user actually cares about. When
    // no favorites exist (fresh install, or a user who hasn't starred any
    // channel yet), fall back to recently-watched live so the rail still
    // has something to show. `liveRailSource` drives the title swap.
    readonly liveRailSource = computed<'favorites' | 'recent'>(() =>
        this.data.globalFavoriteLiveItems().length > 0 ? 'favorites' : 'recent'
    );

    readonly liveOnFavoritesCards = computed<DashboardRailCard[]>(() => {
        if (this.liveRailSource() === 'favorites') {
            return this.data
                .globalFavoriteLiveItems()
                .slice(0, RAIL_ITEM_LIMIT)
                .map((item) => this.toFavoriteCard(item));
        }
        return this.data
            .globalRecentLiveItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentCard(item));
    });

    // Title key flips with the source — "Live now on your favorites" when
    // we're rendering favorites, "Continue with live TV" when we're falling
    // back to recently-watched. Always honest about what the user is seeing.
    readonly liveRailTitleKey = computed(() =>
        liveRailTitleKeyForSource(this.liveRailSource())
    );

    readonly liveRailTotalCount = computed(() =>
        this.liveRailSource() === 'favorites'
            ? this.data.globalFavoriteLiveItems().length
            : this.data.globalRecentLiveItems().length
    );

    // Best-effort EPG lookup keyed by the app-wide M3U XMLTV chain
    // (tvg-id -> tvg-name -> name), with the card title as a final fallback.
    // Xtream/Stalker live items often have no XMLTV side-channel and will
    // simply return null — the card renders without the program row.
    private readonly liveChannelLookupKeys = computed(() =>
        buildLiveEpgLookupKeys(this.liveOnFavoritesCards())
    );

    private readonly playbackPositionReloadKey = computed(() =>
        buildPlaybackPositionReloadKey(this.data.globalRecentVodItems())
    );

    // Re-fetch on rail change AND on a 30s heartbeat so the progress bar
    // catches the boundary between programs without a full page revisit.
    private readonly liveEpgPrograms = toSignal(
        toObservable(this.liveChannelLookupKeys).pipe(
            switchMap((keys) =>
                keys.length === 0
                    ? of(new Map<string, EpgProgram | null>())
                    : interval(LIVE_EPG_TICK_MS).pipe(
                          startWith(0),
                          switchMap(() =>
                              this.epgService.getCurrentProgramsForChannels(
                                  keys
                              )
                          )
                      )
            )
        ),
        { initialValue: new Map<string, EpgProgram | null>() }
    );

    readonly liveOnFavoritesCardsEnriched = computed<DashboardRailCard[]>(
        () => {
            const epgMap = this.liveEpgPrograms();
            // Recompute the now-window each tick so progress moves between
            // 30s ticks even if the program identity is unchanged.
            const now = Date.now();
            return this.liveOnFavoritesCards().map((card) => {
                const program = getLiveEpgProgramForCard(card, epgMap);
                if (!program) {
                    return card;
                }
                return {
                    ...card,
                    nowPlayingTitle: program.title || null,
                    nowPlayingTimeRange: formatEpgTimeRange(program),
                    nowPlayingProgress: calcEpgProgress(program, now),
                };
            });
        }
    );

    readonly favoriteCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalFavoriteItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toFavoriteCard(item))
    );

    readonly xtreamRecentlyAddedCards = computed<DashboardRailCard[]>(() =>
        this.data
            .xtreamRecentlyAddedItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentlyAddedCard(item))
    );

    readonly sourceCards = computed<DashboardRailCard[]>(() =>
        this.data.recentPlaylists().map((playlist) => ({
            id: playlist._id,
            title:
                playlist.title ||
                playlist.filename ||
                this.t('WORKSPACE.DASHBOARD.UNTITLED_SOURCE'),
            subtitle: this.data.getPlaylistProvider(playlist),
            icon: playlist.serverUrl
                ? 'cloud'
                : playlist.macAddress
                  ? 'cast'
                  : 'folder_open',
            link: this.data.getPlaylistLink(playlist),
            actions: buildDashboardSourceActions(
                playlist,
                this.playlistRefreshAction.canRefresh(playlist)
            ),
        }))
    );

    constructor() {
        // Re-entering the dashboard should pick up any DB-backed recent/favorite
        // changes made while viewing details, including newly backfilled
        // backdrops that do not change recency ordering.
        void this.data.reloadGlobalRecentItems();
        void this.data.reloadGlobalFavorites();

        // Refresh when Xtream playlist count changes so a newly added provider
        // populates the rail without a manual dashboard reload.
        effect(() => {
            if (this.xtreamPlaylistCount() === 0) {
                return;
            }

            void this.data.reloadXtreamRecentlyAddedItems(RAIL_ITEM_LIMIT);
        });

        // Reload playback positions when the VOD/series recent set changes.
        // The primitive key keeps live-only recent churn out of the IPC path.
        effect(() => {
            this.playbackPositionReloadKey();
            untracked(() => void this.data.reloadPlaybackPositions());
        });
    }

    onAddPlaylist(type?: WorkspacePlaylistType): void {
        this.shellActions.openAddPlaylistDialog(type);
    }

    markHeroImageFailed(url: string): void {
        this.failedHeroImages.update((state) =>
            state[url] ? state : { ...state, [url]: true }
        );
    }

    onSourceActionSelected(selection: DashboardRailActionSelection): void {
        const playlist = this.data
            .playlists()
            .find((item) => item._id === selection.card.id);

        if (!playlist) {
            return;
        }

        switch (selection.action.id as DashboardSourceActionId) {
            case 'refresh':
                this.playlistRefreshAction.refresh(playlist);
                break;
            case 'playlist-info':
                this.dialog.open(PlaylistInfoComponent, { data: playlist });
                break;
            case 'account-info':
                this.openXtreamAccountInfo(playlist);
                break;
            case 'remove':
                this.confirmRemovePlaylist(playlist);
                break;
        }
    }

    private buildHeroSubtitle(item: GlobalRecentItem): string {
        const parts = [
            item.playlist_name,
            this.data.getRecentItemProviderLabel(item),
            this.data.getRecentItemTypeLabel(item),
        ].filter((value): value is string => Boolean(value));
        return parts.join(' · ');
    }

    private toRecentCard(item: GlobalRecentItem): DashboardRailCard {
        const position = this.data.getPlaybackPositionForItem(item);
        const watchProgress = playbackProgressPercent(position);
        const episodeBadge =
            item.type === 'series' &&
            position?.seasonNumber != null &&
            position?.episodeNumber != null
                ? this.translate.instant(
                      'WORKSPACE.DASHBOARD.SEASON_EPISODE_BADGE',
                      {
                          season: position.seasonNumber,
                          episode: position.episodeNumber,
                      }
                  )
                : null;
        return {
            id: `recent-${item.id}-${item.playlist_id}-${item.viewed_at}`,
            title: item.title,
            subtitle: `${this.data.getRecentItemProviderLabel(item)} · ${this.data.getRecentItemTypeLabel(item)}`,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            epgLookupKey: item.epg_lookup_key,
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
            watchProgress,
            episodeBadge,
        };
    }

    private toFavoriteCard(item: DashboardFavoriteItem): DashboardRailCard {
        return {
            id: `fav-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            subtitle: `${this.data.getFavoriteItemProviderLabel(item)} · ${this.data.getFavoriteItemTypeLabel(item)}`,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            epgLookupKey: item.epg_lookup_key,
            link: this.data.getGlobalFavoriteLink(item),
            state: this.data.getGlobalFavoriteNavigationState(item),
        };
    }

    private toRecentlyAddedCard(
        item: DashboardRecentlyAddedItem
    ): DashboardRailCard {
        const typeLabel = this.data.getRecentlyAddedItemTypeLabel(item);
        const subtitleParts = [item.playlist_name, typeLabel].filter(
            (value): value is string => Boolean(value)
        );
        return {
            id: `added-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            subtitle: subtitleParts.join(' · '),
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            link: this.data.getRecentlyAddedLink(item),
            state: this.data.getRecentlyAddedNavigationState(item),
        };
    }

    private typeIcon(type: 'live' | 'movie' | 'series'): string {
        if (type === 'live') return 'live_tv';
        if (type === 'movie') return 'movie';
        return 'video_library';
    }

    private openXtreamAccountInfo(playlist: PlaylistMeta): void {
        if (!isXtreamAccountPlaylist(playlist)) {
            return;
        }

        const title =
            playlist.title ||
            playlist.filename ||
            this.t('WORKSPACE.DASHBOARD.UNTITLED_SOURCE');

        this.shellActions.openAccountInfo({
            playlist: {
                id: playlist._id,
                name: title,
                title,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            },
        });
    }

    private confirmRemovePlaylist(playlist: PlaylistMeta): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: () => {
                void this.removePlaylist(playlist);
            },
        });
    }

    private async removePlaylist(playlist: PlaylistMeta): Promise<void> {
        const deleted =
            await this.playlistDeleteAction.deletePlaylist(playlist);

        if (!deleted) {
            return;
        }

        this.store.dispatch(
            PlaylistActions.removePlaylist({ playlistId: playlist._id })
        );
        this.snackBar.open(
            this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS'),
            undefined,
            { duration: 2000 }
        );
    }

    private t(key: string): string {
        return this.translate.instant(key);
    }
}
