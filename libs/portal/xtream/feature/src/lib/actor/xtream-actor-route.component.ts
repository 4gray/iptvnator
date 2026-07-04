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
    ActorFilmographyCredit,
    ActorProfile,
    CatalogTitleMatchService,
    TmdbEnrichmentService,
    buildTitleMatchIndex,
    mapPersonFilmography,
    mapPersonProfile,
} from '@iptvnator/services';
import {
    CatalogTitleMatch,
    normalizeTitle,
} from '@iptvnator/shared/interfaces';
import {
    ActorViewComponent,
    ActorViewItem,
    ActorViewScope,
} from '@iptvnator/ui/shared-portals';
import { buildCatalogTitleIndex } from '../tmdb-similar.util';

/**
 * Actor page inside an Xtream portal: TMDB person + full filmography.
 * Scope "This portal" matches against the loaded catalog; "All portals"
 * (Electron only) matches against every imported Xtream playlist via the
 * DB worker. Matched titles navigate straight to their detail view, the
 * rest open the current portal's search prefilled.
 */
@Component({
    template: `<app-actor-view
        [profile]="profile()"
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
    imports: [ActorViewComponent],
})
export class XtreamActorRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);
    private readonly titleMatch = inject(CatalogTitleMatchService);

    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });
    private readonly personId = computed(() =>
        Number(this.routeParams().personId)
    );

    readonly profile = signal<ActorProfile | null>(null);
    private readonly filmography = signal<ActorFilmographyCredit[]>([]);
    readonly isLoading = signal(true);

    readonly showScopeToggle = this.titleMatch.isAvailable;
    readonly scope = signal<ActorViewScope>('portal');
    readonly isMatchingGlobal = signal(false);
    private readonly globalMatches = signal<CatalogTitleMatch[] | null>(null);

    private readonly vodIndex = computed(() =>
        buildCatalogTitleIndex(this.xtreamStore.vodStreams())
    );
    private readonly serialIndex = computed(() =>
        buildCatalogTitleIndex(this.xtreamStore.serialStreams())
    );
    private readonly globalIndex = computed(() =>
        buildTitleMatchIndex(this.globalMatches() ?? [])
    );

    readonly items = computed<ActorViewItem[]>(() => {
        if (this.scope() === 'global') {
            return this.filmography().map((credit) => {
                const match = this.globalMatchFor(credit);
                return {
                    ...credit,
                    available: match !== null,
                    ...(match ? { availableIn: match.playlistName } : {}),
                };
            });
        }

        return this.filmography().map((credit) => ({
            ...credit,
            available: this.portalMatchFor(credit) !== null,
        }));
    });

    constructor() {
        effect(() => {
            const personId = this.personId();
            if (Number.isInteger(personId) && personId > 0) {
                void this.loadPerson(personId);
            }
        });
    }

    onScopeChanged(scope: ActorViewScope): void {
        this.scope.set(scope);
        if (scope === 'global' && this.globalMatches() === null) {
            void this.loadGlobalMatches();
        }
    }

    openItem(item: ActorViewItem): void {
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

    private portalMatchFor(credit: ActorFilmographyCredit) {
        const index =
            credit.mediaType === 'movie' ? this.vodIndex() : this.serialIndex();
        return index.get(normalizeTitle(credit.title)) ?? null;
    }

    private globalMatchFor(
        credit: ActorFilmographyCredit
    ): CatalogTitleMatch | null {
        const type = credit.mediaType === 'movie' ? 'movie' : 'series';
        return (
            this.globalIndex().get(`${type}:${normalizeTitle(credit.title)}`) ??
            null
        );
    }

    private async loadGlobalMatches(): Promise<void> {
        const titles = this.filmography().map((credit) => credit.title);
        this.isMatchingGlobal.set(true);
        try {
            this.globalMatches.set(await this.titleMatch.matchTitles(titles));
        } finally {
            this.isMatchingGlobal.set(false);
        }
    }

    private async loadPerson(personId: number): Promise<void> {
        this.isLoading.set(true);
        this.globalMatches.set(null);
        const person = await this.tmdbEnrichment.getPersonDetails(personId);
        if (personId !== this.personId()) {
            return;
        }
        this.profile.set(person ? mapPersonProfile(person) : null);
        this.filmography.set(person ? mapPersonFilmography(person) : []);
        this.isLoading.set(false);
        if (this.scope() === 'global') {
            void this.loadGlobalMatches();
        }
    }
}
