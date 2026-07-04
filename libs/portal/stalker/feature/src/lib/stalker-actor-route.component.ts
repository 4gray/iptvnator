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
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';
import {
    ActorViewComponent,
    ActorViewItem,
    ActorViewScope,
} from '@iptvnator/ui/shared-portals';

/**
 * Actor page inside a Stalker portal. The portal catalog is
 * server-paginated, so "This portal" has no availability matching — every
 * title opens the portal search prefilled. "All portals" (Electron only)
 * matches against the imported Xtream playlists and navigates there.
 */
@Component({
    template: `<app-actor-view
        [profile]="profile()"
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
    imports: [ActorViewComponent],
})
export class StalkerActorRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly location = inject(Location);
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
            available: false,
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

    private globalMatchFor(
        credit: ActorFilmographyCredit
    ): CatalogTitleMatch | null {
        const type = credit.mediaType === 'movie' ? 'movie' : 'series';
        const key = `${type}:${normalizeTitleKeys(credit.title).exact}`;
        const match = this.globalIndex().get(key) ?? null;
        return match &&
            titleYearsCompatible(credit.year, match.trailingYear)
            ? match
            : null;
    }

    private async loadGlobalMatches(): Promise<void> {
        // Guard against actor→actor navigation: a slow match for the
        // previous person must not overwrite the current one's results
        const requestedPersonId = this.personId();
        const titles = this.filmography().map((credit) => credit.title);
        this.isMatchingGlobal.set(true);
        try {
            const matches = await this.titleMatch.matchTitles(titles);
            if (this.personId() === requestedPersonId) {
                this.globalMatches.set(matches);
            }
        } finally {
            if (this.personId() === requestedPersonId) {
                this.isMatchingGlobal.set(false);
            }
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
