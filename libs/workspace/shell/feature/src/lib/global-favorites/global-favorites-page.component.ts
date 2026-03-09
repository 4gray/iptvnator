import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    ResizableDirective,
    VjsPlayerComponent,
} from 'components';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { firstValueFrom } from 'rxjs';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
    StalkerSessionService,
} from 'services';
import {
    Channel,
    EpgItem,
    EpgProgram,
    Playlist,
    ResolvedPortalPlayback,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';
import { EpgViewComponent } from 'shared-portals';
import { GlobalFavoritesListComponent } from './global-favorites-list.component';
import { GlobalFavoritesService } from './global-favorites.service';
import { UnifiedFavoriteChannel } from './unified-favorite-channel.interface';

interface StalkerCreateLinkResponse {
    readonly js?: {
        readonly cmd?: string;
    };
}

@Component({
    selector: 'app-global-favorites-page',
    templateUrl: './global-favorites-page.component.html',
    styleUrl: './global-favorites-page.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ArtPlayerComponent,
        EpgViewComponent,
        GlobalFavoritesListComponent,
        HtmlVideoPlayerComponent,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        ResizableDirective,
        VjsPlayerComponent,
    ],
})
export class GlobalFavoritesPageComponent implements OnInit {
    private readonly favoritesService = inject(GlobalFavoritesService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly xtreamApi = inject(XtreamApiService);
    private readonly xtreamUrl = inject(XtreamUrlService);
    private readonly dataService = inject(DataService);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);

    readonly player = this.settingsStore.player;
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );

    readonly isLoading = signal(true);
    readonly channels = signal<UnifiedFavoriteChannel[]>([]);
    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly activeUid = signal<string | null>(null);
    readonly epgMap = signal<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = signal(0);
    readonly currentEpgItems = signal<EpgItem[]>([]);
    readonly currentStreamUrl = computed(
        () => this.activePlayback()?.streamUrl ?? ''
    );

    /** Active channel as minimal Channel for InfoOverlayComponent */
    /** Minimal Channel object needed by html5/artplayer components */
    readonly activeChannelForOverlay = computed((): Channel | undefined => {
        const p = this.activePlayback();
        if (!p) return undefined;
        return {
            id: this.activeUid() ?? '',
            name: p.title ?? '',
            url: this.currentStreamUrl(),
            tvg: {
                logo: p.thumbnail ?? '',
                id: '',
                name: '',
                rec: '',
                url: '',
            },
            group: { title: '' },
            http: { referrer: '', 'user-agent': '', origin: '' },
            radio: 'false',
            epgParams: '',
        } as Channel;
    });

    private tickInterval: ReturnType<typeof setInterval> | null = null;

    ngOnInit(): void {
        this.loadFavorites();
        this.tickInterval = setInterval(() => {
            this.progressTick.update((t) => t + 1);
        }, 30_000);
        this.destroyRef.onDestroy(() => {
            if (this.tickInterval) {
                clearInterval(this.tickInterval);
            }
        });
    }

    async onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void> {
        if (this.activeUid() === channel.uid) {
            // Deselect
            this.activeUid.set(null);
            this.activePlayback.set(null);
            this.currentEpgItems.set([]);
            return;
        }
        this.activeUid.set(channel.uid);
        this.currentEpgItems.set([]);

        try {
            const playback = await this.resolvePlayback(channel);
            this.activePlayback.set(playback);
            if (!this.portalPlayer.isEmbeddedPlayer()) {
                void this.portalPlayer.openResolvedPlayback(playback);
            }
            this.loadEpgItemsForChannel(channel).then((items) => {
                this.currentEpgItems.set(items);
            });
        } catch {
            this.activePlayback.set(null);
            this.activeUid.set(null);
        }
    }

    onClose(): void {
        this.activePlayback.set(null);
        this.activeUid.set(null);
        this.currentEpgItems.set([]);
    }

    async onFavoriteToggled(channel: UnifiedFavoriteChannel): Promise<void> {
        await this.favoritesService.removeFavorite(channel);
        this.channels.update((chs) => chs.filter((c) => c.uid !== channel.uid));
        if (this.activeUid() === channel.uid) {
            this.activePlayback.set(null);
            this.activeUid.set(null);
            this.currentEpgItems.set([]);
        }
    }

    async onReorder(reordered: UnifiedFavoriteChannel[]): Promise<void> {
        this.channels.set(reordered);
        await this.favoritesService.reorder(reordered);
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private async loadFavorites(): Promise<void> {
        this.isLoading.set(true);
        try {
            const channels =
                await this.favoritesService.getUnifiedLiveFavorites();
            this.channels.set(channels);
            // Load EPG in background without blocking
            this.loadEpgForChannels(channels);
        } catch {
            this.channels.set([]);
        } finally {
            this.isLoading.set(false);
        }
    }

    private async loadEpgForChannels(
        channels: UnifiedFavoriteChannel[]
    ): Promise<void> {
        const epgMap = new Map<string, EpgProgram | null>(this.epgMap());
        const now = Date.now();

        // Group xtream channels by playlistId to batch credential lookups
        const xtreamByPlaylist = new Map<string, UnifiedFavoriteChannel[]>();
        for (const ch of channels) {
            if (ch.sourceType === 'xtream') {
                const list = xtreamByPlaylist.get(ch.playlistId) ?? [];
                list.push(ch);
                xtreamByPlaylist.set(ch.playlistId, list);
            }
        }

        const tasks: Promise<void>[] = [];

        // M3U EPG
        for (const ch of channels) {
            if (ch.sourceType !== 'm3u' || !ch.tvgId) continue;
            tasks.push(this.loadM3uEpg(ch, epgMap, now));
        }

        // Xtream EPG – one credential lookup per playlist
        for (const [playlistId, chList] of xtreamByPlaylist.entries()) {
            tasks.push(
                this.loadXtreamEpgForPlaylist(playlistId, chList, epgMap, now)
            );
        }

        await Promise.all(tasks.map((t) => t.catch(() => null)));
        this.epgMap.set(new Map(epgMap));
    }

    private async loadM3uEpg(
        ch: UnifiedFavoriteChannel,
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        if (!window.electron?.getChannelPrograms || !ch.tvgId) return;
        try {
            const programs: EpgProgram[] =
                await window.electron.getChannelPrograms(ch.tvgId);
            const current =
                programs.find(
                    (p) =>
                        new Date(p.start).getTime() <= now &&
                        now < new Date(p.stop).getTime()
                ) ?? null;
            epgMap.set(ch.tvgId.trim(), current);
        } catch {
            epgMap.set(ch.tvgId.trim(), null);
        }
    }

    private async loadXtreamEpgForPlaylist(
        playlistId: string,
        channels: UnifiedFavoriteChannel[],
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        let playlist: Playlist | undefined;
        try {
            playlist = await firstValueFrom(
                this.playlistsService.getPlaylistById(playlistId)
            );
        } catch {
            return;
        }

        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            return;
        }

        const credentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };

        await Promise.all(
            channels
                .map(async (ch) => {
                    if (!ch.xtreamId) return;
                    try {
                        const items: EpgItem[] =
                            await this.xtreamApi.getShortEpg(
                                credentials,
                                ch.xtreamId,
                                2
                            );
                        const nowSec = Math.floor(now / 1000);
                        const current =
                            items.find(
                                (p) =>
                                    Number(p.start_timestamp) <= nowSec &&
                                    nowSec < Number(p.stop_timestamp)
                            ) ?? null;

                        const epgKey = ch.tvgId?.trim() || ch.name?.trim();
                        if (epgKey) {
                            epgMap.set(
                                epgKey,
                                current
                                    ? {
                                          start: new Date(
                                              Number(current.start_timestamp) *
                                                  1000
                                          ).toISOString(),
                                          stop: new Date(
                                              Number(current.stop_timestamp) *
                                                  1000
                                          ).toISOString(),
                                          channel: String(ch.xtreamId),
                                          title: current.title,
                                          desc: current.description ?? null,
                                          category: null,
                                      }
                                    : null
                            );
                        }
                    } catch {
                        // skip
                    }
                })
                .map((t) => t.catch(() => null))
        );
    }

    private async resolvePlayback(
        ch: UnifiedFavoriteChannel
    ): Promise<ResolvedPortalPlayback> {
        switch (ch.sourceType) {
            case 'm3u':
                return this.resolveM3uPlayback(ch);
            case 'xtream':
                return this.resolveXtreamPlayback(ch);
            case 'stalker':
                return this.resolveStalkerPlayback(ch);
        }
    }

    private async loadEpgItemsForChannel(
        ch: UnifiedFavoriteChannel
    ): Promise<EpgItem[]> {
        try {
            if (
                ch.sourceType === 'm3u' &&
                ch.tvgId &&
                window.electron?.getChannelPrograms
            ) {
                const programs: EpgProgram[] =
                    await window.electron.getChannelPrograms(ch.tvgId);
                return programs.map((p, i) => ({
                    id: String(i),
                    epg_id: p.channel,
                    title: p.title,
                    lang: 'en',
                    start: p.start,
                    end: p.stop,
                    stop: p.stop,
                    description: p.desc ?? '',
                    channel_id: p.channel,
                    start_timestamp: String(
                        Math.floor(new Date(p.start).getTime() / 1000)
                    ),
                    stop_timestamp: String(
                        Math.floor(new Date(p.stop).getTime() / 1000)
                    ),
                }));
            }
            if (ch.sourceType === 'xtream' && ch.xtreamId) {
                const playlist = (await firstValueFrom(
                    this.playlistsService.getPlaylistById(ch.playlistId)
                )) as Playlist | undefined;
                if (
                    !playlist?.serverUrl ||
                    !playlist.username ||
                    !playlist.password
                ) {
                    return [];
                }
                return await this.xtreamApi.getShortEpg(
                    {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    },
                    ch.xtreamId,
                    10
                );
            }
        } catch {
            // ignore
        }
        return [];
    }

    private resolveM3uPlayback(
        ch: UnifiedFavoriteChannel
    ): ResolvedPortalPlayback {
        return {
            streamUrl: ch.streamUrl ?? '',
            title: ch.name,
            thumbnail: ch.logo ?? null,
        };
    }

    private async resolveXtreamPlayback(
        ch: UnifiedFavoriteChannel
    ): Promise<ResolvedPortalPlayback> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(ch.playlistId)
        )) as Playlist | undefined;
        if (
            ch.xtreamId == null ||
            !playlist?.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            throw new Error('Missing Xtream playback credentials');
        }
        const credentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };
        const streamUrl = this.xtreamUrl.constructLiveUrl(credentials, ch.xtreamId);
        return {
            streamUrl,
            title: ch.name,
            thumbnail: ch.logo ?? null,
        };
    }

    private async resolveStalkerPlayback(
        ch: UnifiedFavoriteChannel
    ): Promise<ResolvedPortalPlayback> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(ch.playlistId)
        )) as Playlist | undefined;

        const portalUrl =
            ch.stalkerPortalUrl ?? playlist?.portalUrl ?? playlist?.url ?? '';
        const macAddress = ch.stalkerMacAddress ?? playlist?.macAddress ?? '';
        const cmd = ch.stalkerCmd ?? '';

        const params = {
            action: StalkerPortalActions.CreateLink,
            cmd,
            type: 'itv' as const,
            disable_ad: '0',
            download: '0',
            JsHttpRequest: '1-xml',
        };

        let response: StalkerCreateLinkResponse | undefined;
        if (playlist?.isFullStalkerPortal && playlist) {
            response = await this.stalkerSession.makeAuthenticatedRequest(
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
        const streamUrl = this.normalizeStalkerCmd(rawCmd);

        return {
            streamUrl,
            title: ch.name,
            thumbnail: ch.logo ?? null,
        };
    }

    private normalizeStalkerCmd(value: string): string {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) return '';
        const splitAt = trimmed.indexOf(' ');
        if (splitAt > 0) {
            const candidate = trimmed.slice(splitAt + 1).trim();
            if (
                candidate.startsWith('http://') ||
                candidate.startsWith('https://')
            ) {
                return candidate;
            }
        }
        return trimmed;
    }
}
