import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
    matchesOpenLiveCollectionItem,
    OpenLiveCollectionItemState,
    PORTAL_PLAYER,
    ResolvedLiveCollectionDetail,
    StreamResolverService,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';
import { EpgListComponent } from '@iptvnator/ui/epg';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import {
    AudioPlayerComponent,
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    VjsPlayerComponent,
} from '@iptvnator/ui/playback';
import { ResizableDirective } from 'components';
import { SettingsStore } from 'services';
import { Channel, EpgProgram } from 'shared-interfaces';
import { EpgViewComponent } from 'shared-portals';

@Component({
    selector: 'app-unified-live-tab',
    templateUrl: './unified-live-tab.component.html',
    styleUrl: './unified-live-tab.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AudioPlayerComponent,
        ArtPlayerComponent,
        EpgListComponent,
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
export class UnifiedLiveTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly searchTerm = input('');
    readonly autoOpenItem = input<OpenLiveCollectionItemState | null>(null);

    readonly removeItem = output<UnifiedCollectionItem>();
    readonly reorderItems = output<UnifiedCollectionItem[]>();
    readonly itemPlayed = output<UnifiedCollectionItem>();
    readonly autoOpenHandled = output<void>();

    private readonly streamResolver = inject(StreamResolverService);
    private readonly recentData = inject(UnifiedRecentDataService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly destroyRef = inject(DestroyRef);

    readonly player = this.settingsStore.player;
    readonly isEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );

    readonly activeDetail = signal<ResolvedLiveCollectionDetail | null>(null);
    readonly activeUid = signal<string | null>(null);
    readonly isSelecting = signal(false);
    readonly epgMap = signal<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = signal(0);
    readonly currentStreamUrl = computed(
        () => this.activeDetail()?.playback.streamUrl ?? ''
    );
    readonly isM3uSelection = computed(
        () => this.activeDetail()?.epgMode === 'm3u'
    );
    readonly currentPortalEpgItems = computed(
        () => this.activeDetail()?.epgItems ?? []
    );
    readonly currentM3uPrograms = computed(() => {
        const detail = this.activeDetail();
        if (detail?.epgMode !== 'm3u') {
            return [];
        }

        return detail.epgPrograms ?? [];
    });
    readonly currentM3uChannel = computed(() => {
        const detail = this.activeDetail();
        if (detail?.epgMode !== 'm3u') {
            return null;
        }

        return detail.channel ?? null;
    });
    readonly activeRadioChannel = computed(() => {
        const channel = this.currentM3uChannel();
        return channel?.radio === 'true' ? channel : null;
    });
    readonly isRadioSelection = computed(() => this.activeRadioChannel() !== null);
    readonly shouldUseInlinePlayer = computed(() => {
        return this.isRadioSelection() || this.isEmbeddedPlayer();
    });
    readonly layoutClass = computed(() => {
        if (this.isRadioSelection()) {
            return 'itv-container itv-container--radio';
        }

        return this.shouldUseInlinePlayer()
            ? 'itv-container'
            : 'itv-container--external';
    });

    readonly activeChannelForOverlay = computed((): Channel | undefined => {
        const detail = this.activeDetail();
        if (!detail) {
            return undefined;
        }

        if (detail.channel) {
            return detail.channel;
        }

        return {
            id: this.activeUid() ?? '',
            name: detail.playback.title ?? '',
            url: detail.playback.streamUrl,
            tvg: {
                logo: detail.playback.thumbnail ?? '',
                id: '',
                name: '',
                rec: '',
                url: '',
            },
            group: { title: '' },
            http: {
                referrer: detail.playback.referer ?? '',
                'user-agent': detail.playback.userAgent ?? '',
                origin: detail.playback.origin ?? '',
            },
            radio: 'false',
            epgParams: '',
        } satisfies Channel;
    });

    readonly channelsForList = computed((): UnifiedFavoriteChannel[] =>
        this.items().map((item) => ({
            uid: item.uid,
            name: item.name,
            logo: item.logo ?? null,
            sourceType: item.sourceType,
            playlistId: item.playlistId,
            playlistName: item.playlistName,
            streamUrl: item.streamUrl,
            xtreamId: item.xtreamId,
            tvgId: item.tvgId,
            stalkerCmd: item.stalkerCmd,
            stalkerPortalUrl: item.stalkerPortalUrl,
            stalkerMacAddress: item.stalkerMacAddress,
            addedAt: item.addedAt ?? new Date(0).toISOString(),
            position: item.position ?? 0,
            contentId: item.contentId,
        }))
    );

    private selectionRequestId = 0;

    constructor() {
        effect(() => {
            const items = this.items();
            void this.loadEpgMap(items);

            const activeUid = this.activeUid();
            if (activeUid && !items.some((item) => item.uid === activeUid)) {
                this.onClose();
            }
        });

        effect(() => {
            const target = this.autoOpenItem();
            const items = this.items();
            if (!target || items.length === 0) {
                return;
            }

            const matchedItem = items.find((item) =>
                matchesOpenLiveCollectionItem(item, target)
            );
            if (!matchedItem) {
                return;
            }

            if (this.activeUid() === matchedItem.uid) {
                if (this.activeDetail()) {
                    this.autoOpenHandled.emit();
                    return;
                }

                if (this.isSelecting()) {
                    return;
                }
            }

            void this.activateItem(matchedItem, true);
        });

        const tickInterval = setInterval(
            () => this.progressTick.update((tick) => tick + 1),
            30_000
        );
        this.destroyRef.onDestroy(() => clearInterval(tickInterval));
    }

    async onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void> {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (!item) {
            return;
        }
        await this.activateItem(item);
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        const item = this.items().find(
            (candidate) => candidate.uid === channel.uid
        );
        if (item) {
            this.removeItem.emit(item);
        }
    }

    onReorder(channels: UnifiedFavoriteChannel[]): void {
        const reordered = channels
            .map((channel) =>
                this.items().find((candidate) => candidate.uid === channel.uid)
            )
            .filter(Boolean) as UnifiedCollectionItem[];
        this.reorderItems.emit(reordered);
    }

    onClose(): void {
        this.selectionRequestId += 1;
        this.isSelecting.set(false);
        this.activeDetail.set(null);
        this.activeUid.set(null);
    }

    private async loadEpgMap(items: UnifiedCollectionItem[]): Promise<void> {
        const epgMap = await this.streamResolver.loadEpgForItems(items);
        this.epgMap.set(epgMap);
    }

    private async activateItem(
        item: UnifiedCollectionItem,
        isAutoOpen = false
    ): Promise<void> {
        if (this.activeUid() === item.uid && this.activeDetail()) {
            if (isAutoOpen) {
                this.autoOpenHandled.emit();
            }
            return;
        }

        const requestId = ++this.selectionRequestId;
        this.activeUid.set(item.uid);
        this.activeDetail.set(null);
        this.isSelecting.set(true);

        try {
            const detail =
                item.sourceType === 'm3u'
                    ? await this.streamResolver.resolveM3uPlaybackDetail(item)
                    : await this.streamResolver.resolveLiveDetail(item);
            if (requestId !== this.selectionRequestId) {
                return;
            }

            this.activeDetail.set(detail);

            if (detail.epgMode === 'm3u') {
                void this.hydrateSelectedM3uPrograms(item, detail, requestId);
            }

            if (this.shouldOpenExternalPlayback(detail)) {
                void this.portalPlayer.openResolvedPlayback(detail.playback);
            }

            try {
                const updatedItem =
                    await this.recentData.recordLivePlayback(item);
                if (requestId === this.selectionRequestId) {
                    this.itemPlayed.emit(updatedItem);
                }
            } catch {
                // Keep playback/EPG visible even if history persistence fails.
            }

            if (requestId === this.selectionRequestId && isAutoOpen) {
                this.autoOpenHandled.emit();
            }
        } catch {
            if (requestId === this.selectionRequestId) {
                this.activeDetail.set(null);
                this.activeUid.set(null);
            }
        } finally {
            if (requestId === this.selectionRequestId) {
                this.isSelecting.set(false);
            }
        }
    }

    private shouldOpenExternalPlayback(
        detail: ResolvedLiveCollectionDetail
    ): boolean {
        return !this.isRadioDetail(detail) && !this.portalPlayer.isEmbeddedPlayer();
    }

    private isRadioDetail(
        detail: ResolvedLiveCollectionDetail | null | undefined
    ): boolean {
        return detail?.epgMode === 'm3u' && detail.channel?.radio === 'true';
    }

    private async hydrateSelectedM3uPrograms(
        item: UnifiedCollectionItem,
        detail: ResolvedLiveCollectionDetail,
        requestId: number
    ): Promise<void> {
        if (detail.epgMode !== 'm3u') {
            return;
        }

        const epgPrograms = await this.streamResolver.loadM3uProgramsForItem(
            item,
            detail.channel
        );
        if (requestId !== this.selectionRequestId) {
            return;
        }

        this.activeDetail.update((currentDetail) => {
            if (!currentDetail || currentDetail.epgMode !== 'm3u') {
                return currentDetail;
            }

            return {
                ...currentDetail,
                epgPrograms,
            };
        });
    }
}
