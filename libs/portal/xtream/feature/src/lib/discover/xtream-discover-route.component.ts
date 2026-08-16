import { Location } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CatalogTitleMatchService,
    DiscoverTitle,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import {
    DiscoverViewComponent,
    TitleResultsScope,
    discoverFacetKey,
    hasDiscoverFacet,
    parseDiscoverParams,
} from '@iptvnator/ui/shared-portals';
import {
    buildCatalogTitleIndex,
    lookupCatalogTitle,
} from '../tmdb-similar.util';

/** One Discover result annotated with catalog availability */
interface DiscoverItem extends DiscoverTitle {
    available: boolean;
    availableIn?: string;
}

/**
 * Discover page inside an Xtream portal: popular TMDB titles for one
 * metadata facet (year, genre or country, from the detail-page chips).
 * Scope "This portal" matches against the loaded catalog; "All portals"
 * (Electron only) matches against every imported Xtream playlist via the
 * DB worker. Matched titles navigate straight to their detail view, the
 * rest open the current portal's search prefilled.
 */
@Component({
    template: `<app-discover-view
        [facets]="facets()"
        [items]="items()"
        [isLoading]="isLoading()"
        [isMatching]="isMatchingGlobal()"
        [showAvailabilityFilter]="true"
        [showScopeToggle]="showScopeToggle"
        [scope]="scope()"
        (scopeChanged)="onScopeChanged($event)"
        (itemClicked)="openItem($event)"
        (backClicked)="goBack()"
    />`,
    styles: [':host { display: block; height: 100%; min-height: 0; }'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DiscoverViewComponent],
})
export class XtreamDiscoverRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);

    private readonly queryParams = toSignal(this.route.queryParams, {
        initialValue: this.route.snapshot.queryParams,
    });
    readonly facets = computed(() => parseDiscoverParams(this.queryParams()));
    // Facets change via query params on the SAME route instance, so every
    // async result is validated against this key, not the instance
    private readonly facetKey = computed(() => discoverFacetKey(this.facets()));

    private readonly results = signal<DiscoverTitle[]>([]);
    readonly isLoading = signal(true);

    readonly showScopeToggle = this.titleMatch.isAvailable;
    readonly scope = signal<TitleResultsScope>('portal');
    readonly isMatchingGlobal = signal(false);
    private readonly globalMatches = signal<CatalogTitleMatch[] | null>(null);

    private readonly vodIndex = computed(() =>
        buildCatalogTitleIndex(this.xtreamStore.vodStreams())
    );
    private readonly serialIndex = computed(() =>
        buildCatalogTitleIndex(this.xtreamStore.serialStreams())
    );
    private readonly globalIndex = computed(() =>
        groupTitleMatchesByKey(this.globalMatches() ?? [])
    );

    readonly items = computed<DiscoverItem[]>(() => {
        if (this.scope() === 'global') {
            return this.results().map((title) => {
                const match = this.globalMatchFor(title);
                return {
                    ...title,
                    available: match !== null,
                    ...(match ? { availableIn: match.playlistName } : {}),
                };
            });
        }

        return this.results().map((title) => ({
            ...title,
            available: this.portalMatchFor(title) !== null,
        }));
    });

    constructor() {
        effect(() => {
            const key = this.facetKey();
            void this.loadDiscover(key);
        });
    }

    onScopeChanged(scope: TitleResultsScope): void {
        this.scope.set(scope);
        if (scope === 'global' && this.globalMatches() === null) {
            void this.loadGlobalMatches();
        }
    }

    openItem(item: DiscoverItem): void {
        if (this.scope() === 'global') {
            const match = this.globalMatchFor(item);
            if (match) {
                void this.router.navigate([
                    '/workspace/xtreams',
                    match.playlistId,
                    match.type === 'movie' ? 'vod' : 'series',
                    match.categoryId,
                    match.xtreamId,
                ]);
                return;
            }
            this.openPortalSearch(item.title);
            return;
        }

        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const match = this.portalMatchFor(item);
        if (playlistId && match) {
            void this.router.navigate([
                '/workspace/xtreams',
                playlistId,
                item.mediaType === 'movie' ? 'vod' : 'series',
                match.categoryId,
                match.id,
            ]);
            return;
        }

        this.openPortalSearch(item.title);
    }

    goBack(): void {
        this.location.back();
    }

    private openPortalSearch(title: string): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }
        void this.router.navigate(
            ['/workspace/xtreams', playlistId, 'search'],
            { queryParams: { q: title } }
        );
    }

    private portalMatchFor(title: DiscoverTitle) {
        const index =
            title.mediaType === 'movie' ? this.vodIndex() : this.serialIndex();
        return lookupCatalogTitle(index, title.title, title.year);
    }

    private globalMatchFor(title: DiscoverTitle): CatalogTitleMatch | null {
        return pickTitleMatch(
            {
                type: title.mediaType === 'movie' ? 'movie' : 'series',
                titles: [title.title],
                year: title.year,
            },
            this.globalIndex()
        );
    }

    private async loadGlobalMatches(): Promise<void> {
        const requestedKey = this.facetKey();
        const titles = this.results().map((title) => title.title);
        this.isMatchingGlobal.set(true);
        try {
            const matches = await this.titleMatch.matchTitles(titles);
            if (this.facetKey() === requestedKey) {
                this.globalMatches.set(matches);
            }
        } finally {
            if (this.facetKey() === requestedKey) {
                this.isMatchingGlobal.set(false);
            }
        }
    }

    private async loadDiscover(requestedKey: string): Promise<void> {
        const facets = this.facets();
        this.isLoading.set(true);
        this.globalMatches.set(null);
        if (!hasDiscoverFacet(facets)) {
            this.results.set([]);
            this.isLoading.set(false);
            return;
        }
        const titles = await this.tmdbEnrichment.discoverTitles(facets.type, {
            year: facets.year,
            genreId: facets.genreId,
            countryCode: facets.countryCode,
        });
        if (this.facetKey() !== requestedKey) {
            return;
        }
        this.results.set(titles ?? []);
        this.isLoading.set(false);
        if (this.scope() === 'global') {
            void this.loadGlobalMatches();
        }
    }
}
