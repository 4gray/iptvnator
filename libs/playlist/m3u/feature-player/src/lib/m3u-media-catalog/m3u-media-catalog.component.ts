import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import type { Channel } from '@iptvnator/shared/interfaces';
import { releaseTagYear } from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils';
import type { M3uSeries } from '@iptvnator/shared/m3u-utils';
import { TmdbEnrichmentService, tmdbPosterUrl } from '@iptvnator/services';

const MOVIE_PAGE_SIZE = 36;
const SERIES_PAGE_SIZE = 48;
const UNORGANIZED_LIMIT = 40;
const POSTER_REQUEST_LIMIT = 8;

/**
 * Read-only M3U catalog: all entries remain their original Channel objects.
 * Paging bounds DOM/image work; TMDB is optional and never scans the library.
 * Existing M3U channel activation owns playback, favorites and persistence.
 */
@Component({
    selector: 'app-m3u-media-catalog',
    templateUrl: './m3u-media-catalog.component.html',
    styleUrl: './m3u-media-catalog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uMediaCatalogComponent {
    private readonly tmdb = inject(TmdbEnrichmentService);

    readonly kind = input.required<'movies' | 'series'>();
    readonly channels = input.required<readonly Channel[]>();
    readonly selected = output<Channel>();

    readonly query = signal('');
    readonly groupFilter = signal('');
    readonly sort = signal<'playlist' | 'az' | 'za'>('playlist');
    readonly page = signal(0);
    readonly selectedSeriesKey = signal<string | null>(null);
    readonly selectedSeason = signal<number | null>(null);
    readonly showUnorganized = signal(false);
    readonly posterOverrides = signal<ReadonlyMap<string, string>>(new Map());

    private readonly attemptedPosters = new Set<string>();

    readonly groups = computed(() =>
        Array.from(new Set(
            this.channels().map(c => c.group?.title?.trim()).filter((v): v is string => !!v)
        )).sort((a, b) => a.localeCompare(b, 'tr'))
    );

    private readonly filteredByGroup = computed(() => {
        const group = this.groupFilter();
        const channels = this.channels();
        return group ? channels.filter(c => c.group?.title?.trim() === group) : channels;
    });

    readonly movieMatches = computed(() => {
        const search = this.query().trim().toLocaleLowerCase('tr-TR');
        const matched = search
            ? this.filteredByGroup().filter(c => c.name.toLocaleLowerCase('tr-TR').includes(search))
            : this.filteredByGroup();
        const sort = this.sort();
        if (sort === 'playlist') return matched;
        return [...matched].sort((a, b) =>
            (sort === 'az' ? 1 : -1) * a.name.localeCompare(b.name, 'tr')
        );
    });
    readonly moviePages = computed(() =>
        Math.max(1, Math.ceil(this.movieMatches().length / MOVIE_PAGE_SIZE))
    );
    readonly currentMoviePage = computed(() =>
        Math.min(this.page(), this.moviePages() - 1)
    );
    readonly moviePage = computed(() =>
        this.movieMatches().slice(
            this.currentMoviePage() * MOVIE_PAGE_SIZE,
            (this.currentMoviePage() + 1) * MOVIE_PAGE_SIZE
        )
    );

    readonly inventory = computed(() =>
        buildM3uSeriesCatalog(this.filteredByGroup())
    );
    readonly seriesMatches = computed(() => {
        const search = this.query().trim().toLocaleLowerCase('tr-TR');
        const all = this.inventory().series;
        const matched = search
            ? all.filter(s => s.title.toLocaleLowerCase('tr-TR').includes(search))
            : all;
        const order = this.sort();
        return order === 'za' ? [...matched].reverse() : matched;
    });
    readonly seriesPages = computed(() =>
        Math.max(1, Math.ceil(this.seriesMatches().length / SERIES_PAGE_SIZE))
    );
    readonly currentSeriesPage = computed(() =>
        Math.min(this.page(), this.seriesPages() - 1)
    );
    readonly seriesPage = computed(() =>
        this.seriesMatches().slice(
            this.currentSeriesPage() * SERIES_PAGE_SIZE,
            (this.currentSeriesPage() + 1) * SERIES_PAGE_SIZE
        )
    );
    readonly currentSeries = computed<M3uSeries | null>(() =>
        this.inventory().series.find(s => s.key === this.selectedSeriesKey()) ?? null
    );
    readonly currentSeason = computed(() => {
        const seasons = this.currentSeries()?.seasons ?? [];
        return seasons.find(s => s.number === this.selectedSeason()) ?? seasons[0] ?? null;
    });
    readonly unorganizedMatches = computed(() => {
        const search = this.query().trim().toLocaleLowerCase('tr-TR');
        const all = this.inventory().unorganized;
        return search ? all.filter(c => c.name.toLocaleLowerCase('tr-TR').includes(search)) : all;
    });
    readonly unorganizedPage = computed(() =>
        this.unorganizedMatches().slice(0, this.showUnorganized() ? UNORGANIZED_LIMIT : 0)
    );

    constructor() {
        effect(() => {
            const entries = this.moviePage();
            if (this.kind() !== 'movies' || !this.tmdb.isEnabled()) return;
            // Max eight *missing* posters per visited page. Never batch-query
            // the 17k+ movie collection or send titles if TMDB is disabled.
            const candidates = entries.filter(c =>
                !c.tvg?.logo?.trim() && !this.attemptedPosters.has(this.entryKey(c))
            ).slice(0, POSTER_REQUEST_LIMIT);
            for (const channel of candidates) this.attemptedPosters.add(this.entryKey(channel));
            untracked(() => { void this.resolveMissingPosters(candidates); });
        });
    }

    private async resolveMissingPosters(entries: readonly Channel[]): Promise<void> {
        for (const channel of entries) {
            try {
                const details = await this.tmdb.enrichMovie({
                    title: channel.name,
                    year: releaseTagYear(channel.name),
                });
                const poster = tmdbPosterUrl(details?.poster_path);
                if (poster) {
                    this.posterOverrides.update(current => {
                        const next = new Map(current);
                        next.set(this.entryKey(channel), poster);
                        return next;
                    });
                }
            } catch {
                // Optional metadata must never block browsing or playback.
            }
        }
    }

    entryKey(channel: Channel): string {
        return JSON.stringify([channel.id, channel.name, channel.url]);
    }
    poster(channel: Channel): string | null {
        return channel.tvg?.logo?.trim() ||
            this.posterOverrides().get(this.entryKey(channel)) || null;
    }
    changeQuery(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.query.set(target.value);
        this.page.set(0);
        this.selectedSeriesKey.set(null);
    }
    changeGroup(event: Event): void {
        this.groupFilter.set((event.target as HTMLSelectElement).value);
        this.page.set(0);
        this.selectedSeriesKey.set(null);
    }
    changeSort(event: Event): void {
        const value = (event.target as HTMLSelectElement).value;
        if (value === 'playlist' || value === 'az' || value === 'za') {
            this.sort.set(value);
            this.page.set(0);
        }
    }
    changePage(delta: number): void {
        const max = this.kind() === 'movies' ? this.moviePages() : this.seriesPages();
        this.page.set(Math.max(0, Math.min(max - 1, this.page() + delta)));
    }
    selectSeries(item: M3uSeries): void {
        this.selectedSeriesKey.set(item.key);
        this.selectedSeason.set(null);
    }
    selectSeason(number: number): void {
        this.selectedSeason.set(number);
    }
}