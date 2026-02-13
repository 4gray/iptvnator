import {
    CdkVirtualScrollViewport,
    ScrollingModule,
} from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    computed,
    inject,
    input,
    OnDestroy,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { FilterPipe } from '@iptvnator/pipes';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { XtreamCategory, XtreamItem } from 'shared-interfaces';
import { EpgQueueService } from '../services/epg-queue.service';
import { XtreamCredentials } from '../services/xtream-api.service';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../stores/xtream.store';

interface EpgProgram {
    id: string;
    title: string;
    start: string;
    end: string;
    start_timestamp: string;
    stop_timestamp: string;
}

type LiveChannelSortMode = 'server' | 'name-asc' | 'name-desc';

@Component({
    selector: 'app-portal-channels-list',
    templateUrl: './portal-channels-list.component.html',
    styleUrls: ['./portal-channels-list.component.scss'],
    imports: [
        DatePipe,
        FilterPipe,
        FormsModule,
        MatFormFieldModule,
        MatIcon,
        MatInputModule,
        ScrollingModule,
        TranslatePipe,
    ],
})
export class PortalChannelsListComponent implements AfterViewInit, OnDestroy {
    readonly playClicked = output<any>();
    readonly sortMode = input<LiveChannelSortMode>('server');

    readonly xtreamStore = inject(XtreamStore);
    private readonly favoritesService = inject(FavoritesService);
    private readonly epgQueueService = inject(EpgQueueService);
    private readonly route = inject(ActivatedRoute);
    readonly channels = this.xtreamStore.selectItemsFromSelectedCategory;
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

        return [...channels].sort((a: any, b: any) => {
            const titleA = a.title ?? a.name ?? '';
            const titleB = b.title ?? b.name ?? '';
            const result = collator.compare(titleA, titleB);
            return mode === 'name-asc' ? result : -result;
        });
    });

    favorites = new Map<number, boolean>();
    searchString = signal<string>('');
    currentPrograms = new Map<number, string>();
    currentProgramsProgress = new Map<number, number>();
    programTimings = new Map<number, { start: number; end: number }>();

    readonly viewport = viewChild(CdkVirtualScrollViewport);

    private subscriptions = new Subscription();

    constructor(private cdr: ChangeDetectorRef) {}

    trackBy(_index: number, item: XtreamItem) {
        return item.xtream_id;
    }

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }

        // Subscribe to EPG results from the queue service
        this.subscriptions.add(
            this.epgQueueService.epgResult$.subscribe(
                ({ streamId, items }) => {
                    if (items && items.length > 0) {
                        this.currentPrograms.set(streamId, items[0].title);
                        this.updateProgramProgress(
                            streamId,
                            items[0] as unknown as EpgProgram
                        );
                        this.cdr.detectChanges();
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
                        const visibleChannels = this.sortedChannels().slice(
                            range.start,
                            range.end
                        );
                        this.loadEpgForVisibleChannels(visibleChannels);
                    })
            );
        }
    }

    private loadEpgForVisibleChannels(channels: any[]): void {
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
            if (cached && cached.length > 0) {
                if (!this.currentPrograms.has(channel.xtream_id)) {
                    this.currentPrograms.set(
                        channel.xtream_id,
                        cached[0].title
                    );
                    this.updateProgramProgress(
                        channel.xtream_id,
                        cached[0] as unknown as EpgProgram
                    );
                }
            } else if (!this.currentPrograms.has(channel.xtream_id)) {
                uncachedIds.push(channel.xtream_id);
            }
        }

        if (uncachedIds.length > 0) {
            this.epgQueueService.enqueue(uncachedIds, visibleIds, credentials);
        }
    }

    private updateProgramProgress(streamId: number, program: EpgProgram) {
        const now = new Date().getTime() / 1000;
        const start = parseInt(program.start_timestamp);
        const end = parseInt(program.stop_timestamp);

        if (now >= start && now <= end) {
            const duration = end - start;
            const elapsed = now - start;
            const progress = (elapsed / duration) * 100;

            this.currentProgramsProgress.set(streamId, progress);
            this.programTimings.set(streamId, {
                start: start * 1000,
                end: end * 1000,
            });
        }
    }

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number((item as any).category_id || item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }

    toggleFavorite(event: Event, item: any) {
        event.stopPropagation();
        this.xtreamStore
            .toggleFavorite(
                item.xtream_id,
                this.xtreamStore.currentPlaylist().id
            )
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
}
