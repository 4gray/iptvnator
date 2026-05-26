import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { parseWorkspaceShellRoute } from '@iptvnator/workspace/shell/util';
import { SEARCH_INPUT_DEBOUNCE_MS } from './helpers/workspace-shell-constants';
import {
    getRouteQueryParam,
    syncSearchQueryParam,
} from './helpers/workspace-shell-route-utils';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';

@Injectable()
export class WorkspaceShellSearchSyncService {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly routeState = inject(WorkspaceShellRouteStateService);

    private searchDebounceTimeoutId: ReturnType<typeof setTimeout> | null =
        null;

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');

    constructor() {
        this.destroyRef.onDestroy(() => {
            if (this.searchDebounceTimeoutId !== null) {
                clearTimeout(this.searchDebounceTimeoutId);
                this.searchDebounceTimeoutId = null;
            }
        });

        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((event) =>
                this.syncSearchFromUrl(event.urlAfterRedirects)
            );

        this.syncSearchFromRoute();

        effect(() => {
            const context = this.routeState.currentContext();
            const section = this.routeState.currentSection();
            const term = this.appliedSearchQuery();

            if (!context || context.provider !== 'xtreams') {
                return;
            }

            if (section === 'search') {
                this.xtreamStore.setSearchTerm(term);
                return;
            }

            if (
                section === 'vod' ||
                section === 'series' ||
                section === 'live'
            ) {
                this.xtreamStore.setCategorySearchTerm(term);
            }
        });

        effect(() => {
            const context = this.routeState.currentContext();
            const section = this.routeState.currentSection();
            const term = this.appliedSearchQuery();

            if (
                context?.provider !== 'stalker' ||
                !section ||
                (section !== 'vod' &&
                    section !== 'series' &&
                    section !== 'itv' &&
                    section !== 'radio')
            ) {
                return;
            }

            this.stalkerStore.setSearchPhrase(term);
        });

        effect(() => {
            if (!this.routeState.currentRoute().usesQuerySearch) {
                return;
            }

            syncSearchQueryParam(
                this.router,
                this.routeState.currentUrl(),
                this.appliedSearchQuery()
            );
        });
    }

    onSearchInput(value: string): void {
        this.searchQuery.set(value);
        this.scheduleSearchApply(value);
    }

    syncSearchFromRoute(): void {
        this.syncSearchFromUrl(this.routeState.currentUrl());
    }

    setSearchState(value: string): void {
        if (this.searchDebounceTimeoutId !== null) {
            clearTimeout(this.searchDebounceTimeoutId);
            this.searchDebounceTimeoutId = null;
        }

        this.searchQuery.set(value);
        this.appliedSearchQuery.set(value);
    }

    applySearchQuery(value: string): void {
        this.appliedSearchQuery.set(value);
    }

    private syncSearchFromUrl(url: string): void {
        if (parseWorkspaceShellRoute(url).usesQuerySearch) {
            this.setSearchState(getRouteQueryParam(this.router, url, 'q'));
            return;
        }

        this.setSearchState('');
    }

    private scheduleSearchApply(value: string): void {
        if (this.searchDebounceTimeoutId !== null) {
            clearTimeout(this.searchDebounceTimeoutId);
        }

        this.searchDebounceTimeoutId = setTimeout(() => {
            this.searchDebounceTimeoutId = null;
            this.applySearchQuery(value);
        }, SEARCH_INPUT_DEBOUNCE_MS);
    }
}
