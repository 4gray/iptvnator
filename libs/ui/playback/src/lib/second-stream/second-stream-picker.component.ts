import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    signal,
    untracked,
    viewChild,
    viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ChannelListItemComponent,
    DialogShellComponent,
} from '@iptvnator/ui/components';
import {
    SECOND_STREAM_HISTORY,
    SecondStreamCatalogService,
    SecondStreamCatalog,
    SecondStreamChannel,
    SecondStreamSelection,
    SecondStreamSource,
} from '@iptvnator/portal/shared/data-access';
import { SecondStreamPickerEpg } from './second-stream-picker-epg';
import { SecondStreamPickerVod } from './second-stream-picker-vod';
import type {
    MultiviewSlot,
    SecondStreamPickerData,
} from './second-stream-open-stream';
import type {
    SecondStreamEpisode,
    SecondStreamVodType,
} from '@iptvnator/portal/shared/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

@Component({
    selector: 'app-second-stream-picker',
    templateUrl: './second-stream-picker.component.html',
    styleUrl: './second-stream-picker.component.scss',
    imports: [
        FormsModule,
        MatButtonModule,
        MatIconModule,
        TranslatePipe,
        ChannelListItemComponent,
        DialogShellComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecondStreamPickerComponent {
    private readonly catalog = inject(SecondStreamCatalogService);
    private readonly dialog =
        inject<
            MatDialogRef<SecondStreamPickerComponent, SecondStreamSelection>
        >(MatDialogRef);
    readonly dialogData = inject<SecondStreamPickerData>(MAT_DIALOG_DATA);
    readonly vod = new SecondStreamPickerVod();
    readonly sources = signal<SecondStreamSource[]>([]);
    readonly source = signal(this.dialogData.initialPlaylist ?? '');
    readonly historySource = SECOND_STREAM_HISTORY;
    readonly group = signal<string | null>(null);
    readonly search = signal('');
    readonly loading = signal(true);
    readonly groupLoading = signal(false);
    readonly resolving = signal<string | null>(null);
    readonly error = signal<'load' | 'play' | 'group' | null>(null);
    readonly duplicateSlot = signal<MultiviewSlot | null>(null);
    readonly data = signal<SecondStreamCatalog>({ groups: [], channels: [] });
    readonly limit = signal(100);
    private request = new AbortController();
    private generation = 0;
    private sourceLoad?: Promise<void>;
    readonly sourceLoadFailed = signal(false);
    private closed = false;
    private seriesSearch = '';
    readonly hasContentTypes = computed(
        () =>
            !this.source() ||
            this.source() === SECOND_STREAM_HISTORY ||
            this.sources().some(
                (source) => source.id === this.source() && source.portal
            )
    );
    private readonly stalkerSource = computed(() =>
        this.sources().some(
            (source) => source.id === this.source() && source.stalker
        )
    );
    readonly searchLabel = computed(() => {
        if (this.vod.series()) return 'PORTALS.DETAIL.EPISODES';
        if (this.vod.type() === 'movie') return 'TMDB_MATCH.SEARCH_MOVIE';
        if (this.vod.type() === 'series') return 'TMDB_MATCH.SEARCH_TV';
        return 'EMBEDDED_MPV.PLAYER.SEARCH_CHANNELS';
    });
    readonly filteredVod = computed(() => {
        if (this.stalkerSource()) return this.vod.items();
        const query = this.search().trim().toLocaleLowerCase();
        return this.vod
            .items()
            .filter((item) => item.name.toLocaleLowerCase().includes(query));
    });
    readonly filteredEpisodes = computed(() => {
        const query = this.search().trim().toLocaleLowerCase();
        return this.vod
            .episodes()
            .filter(
                ({ episode }) =>
                    (episode.title ?? '').toLocaleLowerCase().includes(query) ||
                    String(episode.episode_num).includes(query)
            );
    });
    readonly filtered = computed(() => {
        const search = this.search().trim().toLocaleLowerCase();
        return this.data().channels.filter(
            (row) =>
                (this.group() === null || row.group === this.group()) &&
                (!search || row.item.name.toLocaleLowerCase().includes(search))
        );
    });
    readonly visible = computed(() => this.filtered().slice(0, this.limit()));
    private readonly channelList =
        viewChild<ElementRef<HTMLElement>>('channelList');
    private readonly channelRows = viewChildren('channelRow', {
        read: ElementRef<HTMLElement>,
    });
    readonly epg = new SecondStreamPickerEpg(
        computed(() => (this.vod.type() ? [] : this.visible())),
        this.channelRows,
        this.channelList
    );

    constructor() {
        const cancelRequests = () => {
            this.closed = true;
            this.generation++;
            this.request.abort();
            this.epg.stop();
            this.vod.cancel();
        };
        this.dialog.beforeClosed().subscribe(cancelRequests);
        inject(DestroyRef).onDestroy(cancelRequests);
        void this.loadSources();
        effect(() => {
            this.catalog.version();
            untracked(() => {
                const type = this.vod.type();
                if (type) this.changeType(type);
                else void this.reload();
            });
        });
        effect(() => {
            this.search();
            this.group();
            this.limit.set(100);
        });
    }

    loadSources(): Promise<void> {
        if (this.sourceLoad) return this.sourceLoad;
        this.sourceLoadFailed.set(false);
        this.sourceLoad = this.catalog
            .sources()
            .then((sources) => {
                if (!this.closed) this.sources.set(sources);
            })
            .catch(() => {
                if (!this.closed) this.sourceLoadFailed.set(true);
            })
            .finally(() => {
                this.sourceLoad = undefined;
            });
        return this.sourceLoad;
    }

    updateSearch(value: string): void {
        this.search.set(value);
        const type = this.vod.type();
        if (type && this.stalkerSource() && !this.vod.series()) {
            this.vod.search(this.source(), type, value.trim());
        }
    }

    changeSource(id: string): void {
        this.vod.reset();
        this.source.set(id);
        this.group.set(null);
        this.search.set('');
        void this.reload();
    }

    changeType(type: SecondStreamVodType | null): void {
        this.generation++;
        this.request.abort();
        this.resolving.set(null);
        this.error.set(null);
        this.duplicateSlot.set(null);
        this.limit.set(100);
        if (type)
            void this.vod.browse(this.source(), type, this.search().trim());
        else {
            this.vod.reset();
            void this.reload();
        }
    }

    openSeries(item: UnifiedCollectionItem): void {
        if (this.resolving()) return;
        this.seriesSearch = this.search();
        this.search.set('');
        this.limit.set(100);
        void this.vod.openSeries(item);
    }

    backToSeries(): void {
        this.generation++;
        this.resolving.set(null);
        this.error.set(null);
        this.duplicateSlot.set(null);
        this.search.set(this.seriesSearch);
        this.limit.set(100);
        this.vod.back();
    }

    chooseMovie(item: UnifiedCollectionItem): void {
        void this.resolve(item.uid, () => this.vod.service.resolveMovie(item));
    }

    chooseEpisode(
        series: UnifiedCollectionItem,
        row: SecondStreamEpisode
    ): void {
        void this.resolve(row.episode.id, () =>
            this.vod.service.resolveEpisode(series, row)
        );
    }

    async reload(): Promise<void> {
        const generation = ++this.generation;
        this.request.abort();
        this.request = new AbortController();
        this.loading.set(true);
        this.groupLoading.set(false);
        this.resolving.set(null);
        this.error.set(null);
        this.duplicateSlot.set(null);
        this.data.set({ groups: [], channels: [] });
        try {
            const data = await this.catalog.load(
                this.source(),
                this.request.signal
            );
            if (generation !== this.generation) return;
            this.data.set(data);
            const group = this.group();
            if (
                group !== null &&
                !data.groups.some((entry) => entry.id === group)
            ) {
                this.group.set(null);
            } else if (
                group !== null &&
                !data.channels.some((row) => row.group === group)
            ) {
                this.loading.set(false);
                await this.selectGroup(group);
            }
        } catch {
            if (generation === this.generation) this.error.set('load');
        } finally {
            if (generation === this.generation) this.loading.set(false);
        }
    }

    async selectGroup(id: string | null): Promise<void> {
        this.group.set(id);
        const generation = ++this.generation;
        this.request.abort();
        this.request = new AbortController();
        this.resolving.set(null);
        this.error.set(null);
        this.duplicateSlot.set(null);
        this.groupLoading.set(false);
        if (id === null || this.data().channels.some((row) => row.group === id))
            return;
        this.groupLoading.set(true);
        try {
            const rows = await this.catalog.loadGroup(
                this.source(),
                id,
                this.request.signal
            );
            if (generation === this.generation)
                this.data.update((data) => ({
                    ...data,
                    channels: [...data.channels, ...rows],
                }));
        } catch {
            if (generation === this.generation) this.error.set('group');
        } finally {
            if (generation === this.generation) this.groupLoading.set(false);
        }
    }

    async choose(row: SecondStreamChannel): Promise<void> {
        await this.resolve(row.item.uid, async () => ({
            item: row.item,
            playback: await this.catalog.resolve(row),
        }));
    }

    private async resolve(
        key: string,
        load: () => Promise<SecondStreamSelection>
    ): Promise<void> {
        if (this.resolving()) return;
        const generation = this.generation;
        this.resolving.set(key);
        this.error.set(null);
        this.duplicateSlot.set(null);
        try {
            const selection = await load();
            if (generation !== this.generation) return;
            if (!this.catalog.isAllowed(selection.item)) {
                this.error.set('play');
                return;
            }
            const duplicate = this.dialogData.findDuplicateSlot(selection);
            if (duplicate === undefined) this.dialog.close(selection);
            else this.duplicateSlot.set(duplicate);
        } catch {
            if (generation === this.generation) this.error.set('play');
        } finally {
            if (generation === this.generation) this.resolving.set(null);
        }
    }
}
