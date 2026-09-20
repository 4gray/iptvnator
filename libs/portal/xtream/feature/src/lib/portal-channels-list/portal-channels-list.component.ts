import { ChannelScrollFocusDirective } from '@iptvnator/ui/components';
import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import {
    afterRenderEffect,
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    computed,
    effect,
    inject,
    input,
    OnDestroy,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
    foldSearchText,
    buildXtreamEpgMappingKey,
    EpgItem,
    EpgProgram,
    epgProviderClockMs,
    XtreamCategory,
    XtreamItem,
} from '@iptvnator/shared/interfaces';
import {
    ChannelListItemComponent,
    ChannelListSkeletonComponent,
    EpgMappingDialogComponent,
} from '@iptvnator/ui/components';
import {
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
    PortalChannelSortMode,
    sortPortalChannelItems,
} from '@iptvnator/portal/shared/util';
import { EpgQueueService } from '@iptvnator/portal/xtream/data-access';
import { XtreamCredentials } from '@iptvnator/portal/xtream/data-access';
import { FavoritesService } from '@iptvnator/portal/xtream/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    epgProgramProgressPercent,
    hasEpgProgramEnded,
    pickAiringOrUpcomingEpgItem,
    pickEpgPreviewItem,
    toSharedEpgProgram,
} from './epg-preview-program';
import { EpgRefillLimiter } from './epg-refill-limiter.service';
import { XtreamFavoriteMarksService } from './xtream-favorite-marks.service';

/** How often the rows on screen re-check the programme they are showing. */
const EPG_REFRESH_INTERVAL_MS = 60_000;

export interface XtreamChannelListItem {
    readonly category_id?: string | number;
    readonly id?: string | number;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly type?: 'live' | 'movie' | 'series' | 'vod';
    readonly xtream_id: number;
    readonly epg_channel_id?: string | null;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
}

interface XtreamCategoryLike {
    readonly category_id?: string | number;
    readonly id?: string | number;
}

@Component({
    selector: 'app-portal-channels-list',
    templateUrl: './portal-channels-list.component.html',
    styleUrls: ['./portal-channels-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelScrollFocusDirective,
        ChannelListItemComponent,
        ChannelListSkeletonComponent,
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        ScrollingModule,
        TranslatePipe,
    ],
})
export class PortalChannelsListComponent implements AfterViewInit, OnDestroy {
    readonly playClicked = output<XtreamChannelListItem>();
    readonly playbackRequested = output<XtreamChannelListItem>();
    readonly sortMode = input<PortalChannelSortMode>('server');
    readonly channelsOverride = input<XtreamChannelListItem[] | null>(null);
    readonly searchTermInput = input('');
    /**
     * The fullscreen channel panel stamps a second instance of this list
     * beside the sidebar's. Only the sidebar's pane may carry the
     * `live-channels` id the category list's ArrowRight/ArrowLeft hand-off
     * targets (`ChannelScrollFocusDirective`); a duplicate id would be
     * invalid and could point that hand-off at the hidden copy.
     */
    readonly fullscreenPanelCopy = input(false);
    readonly revealRequest = input<{
        channelId: number;
        sequence: number;
    } | null>(null);

    readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly favoriteMarks = inject(XtreamFavoriteMarksService);
    private readonly epgQueueService = inject(EpgQueueService);
    private readonly route = inject(ActivatedRoute);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly dialog = inject(MatDialog);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');
    readonly contextMenuChannel = signal<XtreamChannelListItem | null>(null);
    readonly contextMenuPosition = signal({ x: '0px', y: '0px' });
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly supportsEpgMapping = this.runtime.supportsEpgMapping;
    readonly channelItemSize = this.supportsEpg ? 68 : 52;
    readonly isSelectedTypeContentLoading =
        this.xtreamStore.selectedTypeContentLoading;
    readonly channels = computed(() => {
        const override = this.channelsOverride();
        if (Array.isArray(override)) {
            return override;
        }

        return this.xtreamStore.selectItemsFromSelectedCategory() as XtreamChannelListItem[];
    });
    readonly sortedChannels = computed(() => {
        const mode = this.sortMode();
        const channels = this.channels();
        return sortPortalChannelItems(
            channels,
            mode,
            (item) => item.title ?? item.name
        );
    });
    readonly filteredChannels = computed(() => {
        const term = foldSearchText(this.searchTermInput().trim());
        const channels = this.sortedChannels();

        if (!term) {
            return channels;
        }

        return channels.filter((item) =>
            foldSearchText(`${item.title ?? ''} ${item.name ?? ''}`).includes(
                term
            )
        );
    });

    favorites = new Map<string, boolean>();
    epgPrograms = new Map<number, EpgProgram>();
    currentProgramsProgress = new Map<number, number>();

    /** Last viewport slice, reused to refresh previews after a mapping change. */
    private lastVisibleChannels: XtreamChannelListItem[] = [];

    /** Periodic re-pick of the visible rows' current program, cleared in `ngOnDestroy`. */
    private epgRefreshIntervalId?: number;

    /**
     * Shared, not per-instance: a live layout mounts this list more than once
     * (sidebar plus the fullscreen channel panel) over one EPG queue, so a
     * local record would give each copy its own refill allowance.
     */
    private readonly epgRefill = inject(EpgRefillLimiter);

    readonly viewport = viewChild(CdkVirtualScrollViewport);

    private subscriptions = new Subscription();
    private readonly settingsStore = inject(SettingsStore);

    constructor(private cdr: ChangeDetectorRef) {
        this.subscriptions.add(
            inject(EpgSourceSettingsService).changed$.subscribe(() => {
                this.repickPreviewsForOffsetChange();
            })
        );
        // A changed display offset moves "now" in the provider's clock, so
        // the visible previews are re-picked from the cached EPG. The first
        // run only records the initial value.
        let appliedOffsetMinutes: number | null = null;
        effect(() => {
            const offsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes();
            if (appliedOffsetMinutes === offsetMinutes) {
                return;
            }
            const isInitial = appliedOffsetMinutes === null;
            appliedOffsetMinutes = offsetMinutes;
            if (isInitial) {
                return;
            }
            untracked(() => this.repickPreviewsForOffsetChange());
        });

        let appliedReveal = -1;
        // A filtered-out viewport is recreated on reveal. CDK attaches its
        // scroll strategy in a microtask after rendering; align on the next
        // frame so scrollToIndex cannot silently run before that attachment.
        afterRenderEffect((onCleanup) => {
            const request = this.revealRequest();
            const viewport = this.viewport();
            const channels = this.filteredChannels();
            if (!request || !viewport || appliedReveal === request.sequence)
                return;
            const index = channels.findIndex(
                (item) => item.xtream_id === request.channelId
            );
            if (index < 0) return;
            const frame = requestAnimationFrame(() => {
                if (
                    this.revealRequest()?.sequence !== request.sequence ||
                    this.viewport() !== viewport
                )
                    return;
                appliedReveal = request.sequence;
                viewport.checkViewportSize();
                viewport.scrollToIndex(index, 'auto');
                viewport.elementRef.nativeElement.focus({
                    preventScroll: true,
                });
            });
            onCleanup(() => cancelAnimationFrame(frame));
        });

        const selectedChannelId = computed(() =>
            Number(
                (
                    this.xtreamStore.selectedItem() as XtreamChannelListItem | null
                )?.xtream_id
            )
        );
        effect(() => {
            const selectedId = selectedChannelId();
            const viewport = this.viewport();

            if (!viewport || !Number.isFinite(selectedId) || selectedId <= 0) {
                return;
            }

            const filteredChannels = untracked(() => this.filteredChannels());
            const selectedIndex = filteredChannels.findIndex(
                (item) => Number(item.xtream_id) === selectedId
            );
            if (selectedIndex < 0) {
                return;
            }

            const top = viewport.measureScrollOffset();
            const rowTop = selectedIndex * this.channelItemSize;
            if (
                rowTop >= top &&
                rowTop + this.channelItemSize <=
                    top + viewport.getViewportSize()
            ) {
                // Even a smooth scroll to the current offset can cancel the
                // user's first keyboard scroll after a pointer selection.
                return;
            }
            viewport.scrollToIndex(selectedIndex, 'smooth');
        });

        effect(() => {
            if (!this.supportsEpg) {
                return;
            }

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

    protected readonly isCatchupAvailable = isXtreamCatchupAvailable;
    protected readonly catchupDays = getXtreamCatchupDays;

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
                        this.favorites.set(
                            this.getFavoriteKey(fav.xtream_id, fav.type),
                            true
                        );
                    });
                });
            // A toggle in another list instance (the sidebar and the
            // fullscreen channel panel render this component side by side)
            // must reach this instance's hearts too.
            this.subscriptions.add(
                this.favoriteMarks.changes$.subscribe((change) => {
                    if (change.playlistId !== playlist.id) {
                        return;
                    }
                    if (change.isFavorite) {
                        this.favorites.set(change.key, true);
                    } else {
                        this.favorites.delete(change.key);
                    }
                    this.cdr.markForCheck();
                })
            );
        }

        if (this.supportsEpg) {
            this.subscriptions.add(
                this.epgQueueService.epgResult$.subscribe(
                    ({ streamId, items }) => {
                        // The earliest-item fallback belongs to a row that has
                        // nothing to show yet. Once a row holds a programme,
                        // only one on air or upcoming may replace it: a refill
                        // answered with the same finished window would
                        // otherwise walk the row back to an older programme,
                        // the very thing the refresh exists to prevent (#767).
                        const previewProgram = this.epgPrograms.has(streamId)
                            ? pickAiringOrUpcomingEpgItem(
                                  items,
                                  this.epgClockMs()
                              )
                            : this.pickPreviewProgram(items);
                        if (previewProgram) {
                            this.applyProgram(streamId, previewProgram);
                        }
                    }
                )
            );

            // Nothing else re-evaluates the shown "current program" as
            // wall-clock time passes (#767): applyProgram() only runs on
            // scroll-into-view, a new EPG result, or an offset change.
            // Mirrors the EPG refresh interval in the M3U sibling
            // `channel-list-container.component.ts`.
            this.epgRefreshIntervalId = window.setInterval(
                () => this.refreshVisiblePrograms(),
                EPG_REFRESH_INTERVAL_MS
            );
        }
    }

    ngAfterViewInit() {
        const vp = this.viewport();
        if (
            this.supportsEpg &&
            vp &&
            this.xtreamStore.selectedContentType() === 'live'
        ) {
            this.subscriptions.add(
                vp.renderedRangeStream
                    .pipe(debounceTime(300))
                    .subscribe((range) => {
                        const visibleChannels = this.filteredChannels().slice(
                            range.start,
                            range.end
                        );
                        this.lastVisibleChannels = visibleChannels;
                        this.loadEpgForVisibleChannels(visibleChannels);
                    })
            );
        }
    }

    /** Wall-clock now in the provider's EPG clock (`epg-display-offset.util.ts`). */
    private epgClockMs(): number {
        return epgProviderClockMs(
            Date.now(),
            this.settingsStore.resolvedEpgOffsetMinutes()
        );
    }

    private repickPreviewsForOffsetChange(): void {
        this.epgPrograms.clear();
        this.currentProgramsProgress.clear();
        const visible = this.lastVisibleChannels.length
            ? this.lastVisibleChannels
            : this.filteredChannels().slice(0, 50);
        this.loadEpgForVisibleChannels(visible);
        this.cdr.markForCheck();
    }

    private loadEpgForVisibleChannels(channels: XtreamChannelListItem[]): void {
        if (!this.supportsEpg) {
            return;
        }

        if (!this.xtreamStore.currentPlaylist()) return;

        const uncachedChannels: XtreamChannelListItem[] = [];

        // Apply cached results immediately
        for (const channel of channels) {
            const cached = this.epgQueueService.getCached(channel.xtream_id);
            if (cached !== null) {
                const previewProgram = this.pickPreviewProgram(cached);
                if (
                    previewProgram &&
                    !this.epgPrograms.has(channel.xtream_id)
                ) {
                    this.applyProgram(channel.xtream_id, previewProgram);
                }

                continue;
            }

            if (!this.epgPrograms.has(channel.xtream_id)) {
                uncachedChannels.push(channel);
            }
        }

        this.requestEpgFor(uncachedChannels, channels);
    }

    /**
     * Advances the programme shown under the rows on screen as wall-clock
     * time passes (#767) — nothing else re-evaluates it, so a row stayed
     * pinned to a finished programme until the category was left and
     * re-entered.
     *
     * A programme that is still on air only has its progress bar moved: no
     * cache read, no request. Once it ends the row is re-picked from the
     * queue's cache, and a cache holding nothing on air or upcoming is
     * dropped so the next fetch can refill it. A finished programme is never
     * re-applied — it would keep presenting itself as current, and the
     * earliest-item fallback used for a first paint could even move the row
     * backwards. What is on screen stays there until a replacement arrives,
     * so a refreshing row never blanks out.
     */
    private refreshVisiblePrograms(): void {
        const channels = this.lastVisibleChannels;
        if (!this.supportsEpg || channels.length === 0) {
            return;
        }

        if (!this.xtreamStore.currentPlaylist()) return;

        const now = this.epgClockMs();
        const wallClockNow = Date.now();
        const staleChannels: XtreamChannelListItem[] = [];
        let movedProgress = false;

        for (const channel of channels) {
            const shown = this.epgPrograms.get(channel.xtream_id);
            if (shown && !hasEpgProgramEnded(shown, now)) {
                this.updateProgramProgress(channel.xtream_id, shown);
                movedProgress = true;
                continue;
            }

            const cached = this.epgQueueService.getCached(channel.xtream_id);
            if (cached === null) {
                staleChannels.push(channel);
                continue;
            }

            const replacement = pickAiringOrUpcomingEpgItem(cached, now);
            if (replacement) {
                this.applyProgram(channel.xtream_id, replacement);
                continue;
            }

            if (cached.length === 0) {
                // The provider has nothing for this channel and said so; that
                // empty answer is cached on purpose, and asking again before
                // it expires would put one request per EPG-less visible row
                // on the wire every minute.
                continue;
            }

            if (!this.epgRefill.claim(channel.xtream_id, wallClockNow)) {
                continue;
            }

            // Every cached programme has ended. The entry stays valid for
            // minutes and the queue skips a stream that still has one, so it
            // has to go before the refill below can reach the provider.
            this.epgQueueService.invalidate(channel.xtream_id);
            staleChannels.push(channel);
        }

        this.requestEpgFor(staleChannels, channels);
        this.epgRefill.forgetExpired(wallClockNow);
        if (movedProgress) {
            // A replaced row already rendered through applyProgram(); this is
            // for the progress bars that advanced without one.
            this.cdr.markForCheck();
        }
    }

    /**
     * Queues EPG for `channels`. `visibleChannels` is the full viewport slice:
     * the queue drops anything outside the visible set it was last handed, so
     * passing only the subset being fetched would strand entries queued for
     * the other rows on screen.
     */
    private requestEpgFor(
        channels: XtreamChannelListItem[],
        visibleChannels: XtreamChannelListItem[]
    ): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist || channels.length === 0) return;

        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            serverTimezone: playlist.serverTimezone,
        };

        this.epgQueueService
            .enqueue(
                channels.map((channel) => ({
                    streamId: channel.xtream_id,
                    epgChannelId: channel.epg_channel_id ?? null,
                    playlistId: playlist.id ?? null,
                })),
                new Set(visibleChannels.map((channel) => channel.xtream_id)),
                credentials
            )
            .catch((error) => {
                console.warn('EPG enqueue failed', error);
            });
    }

    private updateProgramProgress(streamId: number, program: EpgProgram) {
        const progress = epgProgramProgressPercent(program, this.epgClockMs());
        if (progress === null) {
            this.currentProgramsProgress.delete(streamId);
            return;
        }

        this.currentProgramsProgress.set(streamId, progress);
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

        const favoriteKey = this.favoriteKeyFor(item);
        const contentType = this.getContentTypeForItem(item);

        this.xtreamStore
            .toggleFavorite(item.xtream_id, playlistId, contentType)
            .then((result: boolean) => {
                if (result) {
                    this.favorites.set(favoriteKey, true);
                } else {
                    this.favorites.delete(favoriteKey);
                }
                this.cdr.detectChanges();
                this.favoriteMarks.notify({
                    playlistId,
                    key: favoriteKey,
                    isFavorite: result,
                });
            });
    }

    favoriteKeyFor(item: XtreamChannelListItem): string {
        return this.getFavoriteKey(
            item.xtream_id,
            item.type ?? this.xtreamStore.selectedContentType()
        );
    }

    private getFavoriteKey(
        xtreamId: number,
        type?: 'live' | 'movie' | 'series' | 'vod'
    ): string {
        return `${this.normalizeContentType(type)}:${xtreamId}`;
    }

    private getContentTypeForItem(
        item: XtreamChannelListItem
    ): 'live' | 'movie' | 'series' {
        return this.normalizeContentType(
            item.type ?? this.xtreamStore.selectedContentType()
        );
    }

    private normalizeContentType(
        type?: 'live' | 'movie' | 'series' | 'vod'
    ): 'live' | 'movie' | 'series' {
        if (type === 'movie' || type === 'vod') {
            return 'movie';
        }

        if (type === 'series') {
            return 'series';
        }

        return 'live';
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
        if (this.epgRefreshIntervalId !== undefined) {
            clearInterval(this.epgRefreshIntervalId);
        }
    }

    private applyProgram(streamId: number, program: EpgItem): void {
        const shownProgram = toSharedEpgProgram(program);
        this.epgPrograms.set(streamId, shownProgram);
        this.updateProgramProgress(streamId, shownProgram);
        if (!hasEpgProgramEnded(shownProgram, this.epgClockMs())) {
            // A programme that has not run out proves the guide is flowing,
            // so the next gap on this row may be refilled straight away.
            this.epgRefill.release(streamId);
        }
        this.cdr.detectChanges();
    }

    private pickPreviewProgram(items: EpgItem[]): EpgItem | null {
        return pickEpgPreviewItem(items, this.epgClockMs());
    }

    // ── Context menu ────────────────────────────────────────────

    onChannelContextMenu(
        channel: XtreamChannelListItem,
        event: MouseEvent
    ): void {
        this.contextMenuChannel.set(channel);
        this.contextMenuPosition.set({
            x: `${event.clientX}px`,
            y: `${event.clientY}px`,
        });

        const trigger = this.contextMenuTrigger();
        if (trigger.menuOpen) {
            trigger.closeMenu();
        }

        queueMicrotask(() => {
            this.contextMenuTrigger().openMenu();
        });
    }

    openEpgMapping(): void {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const xtreamId = channel.xtream_id ?? channel.id;
        if (!playlistId || xtreamId == null) {
            return;
        }

        const channelKey = buildXtreamEpgMappingKey(playlistId, xtreamId);
        void this.openEpgMappingDialog(
            channelKey,
            channel,
            xtreamId,
            playlistId
        );
    }

    private async openEpgMappingDialog(
        channelKey: string,
        channel: XtreamChannelListItem,
        streamId: number,
        playlistId: string
    ): Promise<void> {
        const mappingBefore = await this.readEpgMapping(channelKey);

        EpgMappingDialogComponent.open(this.dialog, {
            channelKey,
            channelName: channel.title ?? channel.name ?? String(streamId),
            playlistId,
        })
            .afterClosed()
            .subscribe(async () => {
                const mappingAfter = await this.readEpgMapping(channelKey);
                if (mappingAfter === mappingBefore) {
                    return;
                }
                // The mapping changed (saved or removed) — drop the cached
                // preview/resolution and refetch so the row updates now
                // instead of after the 5-minute TTL or the next scroll.
                this.epgQueueService.invalidate(streamId);
                this.epgPrograms.delete(streamId);
                this.currentProgramsProgress.delete(streamId);
                const visible = this.lastVisibleChannels.length
                    ? this.lastVisibleChannels
                    : this.filteredChannels().slice(0, 50);
                this.loadEpgForVisibleChannels(visible);
            });
    }

    /** Read the current mapped EPG channel id, or null (PWA / no mapping). */
    private async readEpgMapping(channelKey: string): Promise<string | null> {
        if (!this.supportsEpgMapping) {
            return null;
        }
        const bridge = (
            window as unknown as {
                electron?: {
                    getEpgMapping?: (
                        key: string
                    ) => Promise<{ epgChannelId?: string } | null>;
                };
            }
        ).electron;
        try {
            const mapping = await bridge?.getEpgMapping?.(channelKey);
            return mapping?.epgChannelId?.trim() || null;
        } catch {
            return null;
        }
    }
}
