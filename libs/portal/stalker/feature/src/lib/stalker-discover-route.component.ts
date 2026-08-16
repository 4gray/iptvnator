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
import {
    CatalogTitleMatchService,
    DiscoverTitle,
    TmdbEnrichmentService,
    groupTitleMatchesByKey,
    pickTitleMatch,
} from '@iptvnator/services';
import { CatalogTitleMatch } from '@iptvnator/shared/interfaces';
import { createLatestRequestGuard } from '@iptvnator/portal/shared/util';
import {
    DiscoverViewComponent,
    TitleResultsScope,
    discoverFacetKey,
    hasDiscoverFacet,
    parseDiscoverParams,
} from '@iptvnator/ui/shared-portals';

/** One Discover result annotated with catalog availability */
interface DiscoverItem extends DiscoverTitle {
    available: boolean;
    availableIn?: string;
}

/**
 * Discover page inside a Stalker portal. The portal catalog is
 * server-paginated, so "This portal" has no availability matching — every
 * title opens the portal search prefilled. "All portals" (Electron only)
 * matches against the imported Xtream playlists and navigates there.
 */
@Component({
    template: `<app-discover-view
        [facets]="facets()"
        [items]="items()"
        [isLoading]="isLoading()"
        [isMatching]="isMatchingGlobal()"
        [showAvailabilityFilter]="scope() === 'global'"
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
export class StalkerDiscoverRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
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
    private readonly matchRequest = createLatestRequestGuard();
    private readonly discoverRequest = createLatestRequestGuard();
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
            available: false,
        }));
    });

    constructor() {
        effect(() => {
            this.facetKey();
            void this.loadDiscover();
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
        }

        const playlistId = this.playlistIdFromRoute();
        if (!playlistId) {
            return;
        }
        void this.router.navigate(
            ['/workspace/stalker', playlistId, 'search'],
            { queryParams: { q: item.title } }
        );
    }

    goBack(): void {
        this.location.back();
    }

    /** The portal ':id' param lives on an ancestor route */
    private playlistIdFromRoute(): string | null {
        for (const snapshot of this.route.snapshot.pathFromRoot) {
            const id = snapshot.params['id'];
            if (typeof id === 'string' && id !== '') {
                return id;
            }
        }
        return null;
    }

    private globalMatchFor(title: DiscoverTitle): CatalogTitleMatch | null {
        return pickTitleMatch(
            {
                type: title.mediaType === 'movie' ? 'movie' : 'series',
                // The localized title first, then TMDB's original: the
                // catalog stores whatever the panel named the file
                titles: title.originalTitle
                    ? [title.title, title.originalTitle]
                    : [title.title],
                year: title.year,
            },
            this.globalIndex()
        );
    }

    private async loadGlobalMatches(): Promise<void> {
        const requestedKey = this.facetKey();
        // Both names go to the worker so its FTS can hit either one
        const titles: string[] = [];
        for (const result of this.results()) {
            titles.push(result.title);
            if (result.originalTitle) {
                titles.push(result.originalTitle);
            }
        }
        const matchToken = this.matchRequest.start();
        this.isMatchingGlobal.set(true);
        try {
            const matches = await this.titleMatch.matchTitles(titles);
            if (
                this.matchRequest.isLatest(matchToken) &&
                this.facetKey() === requestedKey
            ) {
                this.globalMatches.set(matches);
            }
        } finally {
            // Only the newest request may clear the indicator. Keying this
            // on the subject instead strands the spinner when the user
            // leaves the scope and no replacement request ever runs.
            if (this.matchRequest.isLatest(matchToken)) {
                this.isMatchingGlobal.set(false);
            }
        }
    }

    private async loadDiscover(): Promise<void> {
        const facets = this.facets();
        // A facet change to B and back to A leaves two in-flight requests
        // with the SAME key, so recency — not the key — decides who may
        // commit: otherwise the older one's failure blanks valid results
        const token = this.discoverRequest.start();
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
        if (!this.discoverRequest.isLatest(token)) {
            return;
        }
        this.results.set(titles ?? []);
        this.isLoading.set(false);
        if (this.scope() === 'global') {
            void this.loadGlobalMatches();
        }
    }
}
