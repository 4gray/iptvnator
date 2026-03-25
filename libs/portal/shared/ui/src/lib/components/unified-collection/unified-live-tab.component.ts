import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    input,
    OnInit,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
    StreamResolverService,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import {
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    VjsPlayerComponent,
} from '@iptvnator/ui/playback';
import { ResizableDirective } from 'components';
import { SettingsStore } from 'services';
import { Channel, EpgItem, EpgProgram, ResolvedPortalPlayback } from 'shared-interfaces';
import { EpgViewComponent } from 'shared-portals';

@Component({
    selector: 'app-unified-live-tab',
    templateUrl: './unified-live-tab.component.html',
    styleUrl: './unified-live-tab.component.scss',
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
export class UnifiedLiveTabComponent implements OnInit {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly searchTerm = input('');

    readonly removeItem = output<UnifiedCollectionItem>();
    readonly reorderItems = output<UnifiedCollectionItem[]>();

    private readonly streamResolver = inject(StreamResolverService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly destroyRef = inject(DestroyRef);

    readonly player = this.settingsStore.player;
    readonly isEmbeddedPlayer = computed(() => this.portalPlayer.isEmbeddedPlayer());

    readonly activePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly activeUid = signal<string | null>(null);
    readonly epgMap = signal<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = signal(0);
    readonly currentEpgItems = signal<EpgItem[]>([]);
    readonly currentStreamUrl = computed(() => this.activePlayback()?.streamUrl ?? '');

    readonly activeChannelForOverlay = computed((): Channel | undefined => {
        const p = this.activePlayback();
        if (!p) return undefined;
        return {
            id: this.activeUid() ?? '',
            name: p.title ?? '',
            url: this.currentStreamUrl(),
            tvg: { logo: p.thumbnail ?? '', id: '', name: '', rec: '', url: '' },
            group: { title: '' },
            http: { referrer: '', 'user-agent': '', origin: '' },
            radio: 'false',
            epgParams: '',
        } as Channel;
    });

    /** Map UnifiedCollectionItem[] to UnifiedFavoriteChannel[] for the list component */
    readonly channelsForList = computed((): UnifiedFavoriteChannel[] => {
        return this.items().map((i) => ({
            uid: i.uid,
            name: i.name,
            logo: i.logo ?? null,
            sourceType: i.sourceType,
            playlistId: i.playlistId,
            playlistName: i.playlistName,
            streamUrl: i.streamUrl,
            xtreamId: i.xtreamId,
            tvgId: i.tvgId,
            stalkerCmd: i.stalkerCmd,
            stalkerPortalUrl: i.stalkerPortalUrl,
            stalkerMacAddress: i.stalkerMacAddress,
            addedAt: i.addedAt ?? new Date(0).toISOString(),
            position: i.position ?? 0,
            contentId: i.contentId,
        }));
    });

    private tickInterval: ReturnType<typeof setInterval> | null = null;

    ngOnInit(): void {
        this.loadEpg();
        this.tickInterval = setInterval(() => this.progressTick.update((t) => t + 1), 30_000);
        this.destroyRef.onDestroy(() => {
            if (this.tickInterval) clearInterval(this.tickInterval);
        });
    }

    async onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void> {
        const item = this.items().find((i) => i.uid === channel.uid);
        if (!item) return;

        if (this.activeUid() === item.uid) {
            this.activeUid.set(null);
            this.activePlayback.set(null);
            this.currentEpgItems.set([]);
            return;
        }
        this.activeUid.set(item.uid);
        this.currentEpgItems.set([]);
        try {
            const playback = await this.streamResolver.resolvePlayback(item);
            this.activePlayback.set(playback);
            if (!this.portalPlayer.isEmbeddedPlayer()) {
                void this.portalPlayer.openResolvedPlayback(playback);
            }
            this.streamResolver.loadEpgItems(item).then((epgItems) => {
                this.currentEpgItems.set(epgItems);
            });
        } catch {
            this.activePlayback.set(null);
            this.activeUid.set(null);
        }
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        const item = this.items().find((i) => i.uid === channel.uid);
        if (item) this.removeItem.emit(item);
    }

    onReorder(channels: UnifiedFavoriteChannel[]): void {
        const reordered = channels
            .map((ch) => this.items().find((i) => i.uid === ch.uid))
            .filter(Boolean) as UnifiedCollectionItem[];
        this.reorderItems.emit(reordered);
    }

    onClose(): void {
        this.activePlayback.set(null);
        this.activeUid.set(null);
        this.currentEpgItems.set([]);
    }

    private async loadEpg(): Promise<void> {
        const map = await this.streamResolver.loadEpgForItems(this.items());
        this.epgMap.set(map);
    }
}
