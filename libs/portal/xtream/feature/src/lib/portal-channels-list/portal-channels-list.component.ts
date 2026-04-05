import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    computed,
    effect,
    inject,
    input,
    OnDestroy,
    output,
    viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
    EpgItem,
    EpgProgram,
    XtreamCategory,
    XtreamItem,
} from 'shared-interfaces';
import { ChannelListItemComponent } from 'components';
import { EpgQueueService } from '@iptvnator/portal/xtream/data-access';
import { XtreamCredentials } from '@iptvnator/portal/xtream/data-access';
import { FavoritesService } from '@iptvnator/portal/xtream/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

type LiveChannelSortMode = 'server' | 'name-asc' | 'name-desc';

export interface XtreamChannelListItem {
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly xtream_id: number;
}

interface XtreamCategoryLike {
    readonly category_id?: string | number;
    readonly id?: string | number;
}

@Component({
    selector: 'app-portal-channels-list',
    templateUrl: './portal-channels-list.component.html',
    styleUrls: ['./portal-channels-list.component.scss'],
    imports: [
        ChannelListItemComponent,
        MatIcon,
        ScrollingModule,
        TranslatePipe,
    ],
})
export class PortalChannelsListComponent implements AfterViewInit, OnDestroy {
    readonly playClicked = output<XtreamChannelListItem>();
    readonly sortMode = input<LiveChannelSortMode>('server');
    readonly channelsOverride = input<XtreamChannelListItem[] | null>(null);
    readonly searchTermInput = input('');

    readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly epgQueueService = inject(EpgQueueService);
    private readonly route = inject(ActivatedRoute);
    readonly isSelectedTypeContentLoading =
        this.xtreamStore.selectedTypeContentLoading;
    readonly loadingRows = Array.from({ length: 9 }, (_, index) => index);
    readonly channels = computed(() => {
        const override = this.channelsOverride();
        if (Array.isArray(override)) {
            return override;
        }

        return this.xtreamStore.selectItemsFromSelectedCategory() as
            XtreamChannelListItem[];
    });
    readonly sortedChannels = computed(() => {
        const mode = this.sortMode();
        const channels = this.channels();
        if (mode === 'server') {
            return channels;
        }

        const collator = new Intl.Collator(undefined, {
            numeric: true,
            sensitivity: 'base',
        });

        return [...channels].sort((a, b) => {
            const titleA = a.title ?? a.name ?? '';
            const titleB = b.title ?? b.name ?? '';
            const result = collator.compare(titleA, titleB);
            return mode === 'name-asc' ? result : -result;
        });
    });
    readonly filteredChannels = computed(() => {
        const term = this.searchTermInput().trim().toLowerCase();
        const channels = this.sortedChannels();

        if (!term) {
            return channels;
        }

        return channels.filter((item) =>
            `${item.title ?? ''} ${item.name ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });

    favorites = new Map<number, boolean>();
    epgPrograms = new Map<number, EpgProgram>();
    currentProgramsProgress = new Map<number, number>();

    readonly viewport = viewChild(CdkVirtualScrollViewport);

    private subscriptions = new Subscription();

    constructor(private cdr: ChangeDetectorRef) {
        effect(() => {
            const selectedItem = this.xtreamStore.selectedItem();
            const epgItems = this.xtreamStore.epgItems();

            if (!selectedItem?.xtream_id || epgItems.length === 0) {
                return;
            }

            const previewProgram = this.pickPreviewProgram(epgItems);
            if (!previewProgram) {
                return;
            }

            this.applyProgram(selectedItem.xtream_id, previewProgram);
        });
    }

    trackBy(_index: number, item: XtreamChannelListItem | XtreamItem) {
        return item.xtream_id;
    }

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        if (categoryId && !this.channelsOverride())
            this.xtreamStore.setSelectedCategory(Number(categoryId));

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    favorites.forEach((fav) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }

        // Subscribe to EPG results from the queue service
        this.subscriptions.add(
            this.epgQueueService.epgResult$.subscribe(
                ({ streamId, items }) => {
                    const previewProgram = this.pickPreviewProgram(items);
                    if (previewProgram) {
                        this.applyProgram(streamId, previewProgram);
                    }
                }
            )
        );
    }

    ngAfterViewInit() {
        const vp = this.viewport();
        if (vp && this.xtreamStore.selectedContentType() === 'live') {
            this.subscriptions.add(
                vp.renderedRangeStream
                    .pipe(debounceTime(300))
                    .subscribe((range) => {
                        const visibleChannels = this.filteredChannels().slice(
                            range.start,
                            range.end
                        );
                        this.loadEpgForVisibleChannels(visibleChannels);
                    })
            );
        }
    }

    private loadEpgForVisibleChannels(channels: XtreamChannelListItem[]): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) return;

        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };

        const visibleIds = new Set<number>(
            channels.map((ch) => ch.xtream_id)
        );
        const uncachedIds: number[] = [];

        // Apply cached results immediately
        for (const channel of channels) {
            const cached = this.epgQueueService.getCached(channel.xtream_id);
            if (cached !== null) {
                const previewProgram = this.pickPreviewProgram(cached);
                if (previewProgram) {
                    if (!this.epgPrograms.has(channel.xtream_id)) {
                        this.applyProgram(channel.xtream_id, previewProgram);
                    }
                }

                continue;
            }

            if (!this.epgPrograms.has(channel.xtream_id)) {
                uncachedIds.push(channel.xtream_id);
            }
        }

        if (uncachedIds.length > 0) {
            this.epgQueueService.enqueue(uncachedIds, visibleIds, credentials);
        }
    }

    private updateProgramProgress(
        streamId: number,
        program: EpgItem
    ) {
        const now = Date.now();
        const start = this.getProgramTimestampMs(
            program.start,
            program.start_timestamp
        );
        const end = this.getProgramTimestampMs(
            program.stop ?? program.end,
            program.stop_timestamp
        );

        if (now >= start && now <= end) {
            const duration = end - start;
            const elapsed = now - start;
            const progress = (elapsed / duration) * 100;

            this.currentProgramsProgress.set(streamId, progress);
            return;
        }

        this.currentProgramsProgress.delete(streamId);
    }

    isSelected(item: XtreamCategory | XtreamCategoryLike): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number(item.category_id ?? item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }

    toggleFavorite(event: Event, item: XtreamChannelListItem) {
        event.stopPropagation();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }

        this.xtreamStore
            .toggleFavorite(item.xtream_id, playlistId)
            .then((result: boolean) => {
                if (result) {
                    this.favorites.set(item.xtream_id, true);
                } else {
                    this.favorites.delete(item.xtream_id);
                }
                this.cdr.detectChanges();
            });
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
    }

    private applyProgram(streamId: number, program: EpgItem): void {
        this.epgPrograms.set(streamId, this.toSharedEpgProgram(program));
        this.updateProgramProgress(streamId, program);
        this.cdr.detectChanges();
    }

    private pickPreviewProgram(items: EpgItem[]): EpgItem | null {
        if (!items.length) {
            return null;
        }

        const now = Date.now();
        const normalizedItems = [...items].sort(
            (a, b) =>
                this.getProgramTimestampMs(a.start, a.start_timestamp) -
                this.getProgramTimestampMs(b.start, b.start_timestamp)
        );

        const currentProgram = normalizedItems.find((item) => {
            const start = this.getProgramTimestampMs(
                item.start,
                item.start_timestamp
            );
            const end = this.getProgramTimestampMs(
                item.stop ?? item.end,
                item.stop_timestamp
            );
            return now >= start && now <= end;
        });

        if (currentProgram) {
            return currentProgram;
        }

        const nextProgram = normalizedItems.find((item) => {
            return (
                this.getProgramTimestampMs(item.start, item.start_timestamp) >
                now
            );
        });

        return nextProgram ?? normalizedItems[0];
    }

    private getProgramTimestampMs(
        dateValue: string | undefined,
        unixTimestampValue: string | undefined
    ): number {
        const unixTimestamp = Number(unixTimestampValue);
        if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
            return unixTimestamp * 1000;
        }

        return new Date(dateValue ?? '').getTime();
    }

    private toSharedEpgProgram(program: EpgItem): EpgProgram {
        return {
            start: program.start,
            stop: program.stop ?? program.end,
            channel: program.channel_id ?? program.id,
            title: program.title,
            desc: program.description ?? null,
            category: null,
            startTimestamp: this.getProgramTimestampSeconds(
                program.start,
                program.start_timestamp
            ),
            stopTimestamp: this.getProgramTimestampSeconds(
                program.stop ?? program.end,
                program.stop_timestamp
            ),
        };
    }

    private getProgramTimestampSeconds(
        dateValue: string | undefined,
        unixTimestampValue: string | undefined
    ): number | null {
        const unixTimestamp = Number(unixTimestampValue);
        if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
            return unixTimestamp;
        }

        const parsedDate = new Date(dateValue ?? '').getTime();
        return Number.isFinite(parsedDate)
            ? Math.floor(parsedDate / 1000)
            : null;
    }
}
