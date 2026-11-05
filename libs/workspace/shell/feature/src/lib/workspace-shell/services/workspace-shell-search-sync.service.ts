import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { parseWorkspaceShellRoute } from '@iptvnator/workspace/shell/util';
import { SettingsSearchService } from '@iptvnator/workspace/shell/util/settings-search';
import {
    CATEGORY_SCOPE_CLEAR_NAVIGATION,
    SEARCH_INPUT_DEBOUNCE_MS,
} from './helpers/workspace-shell-constants';
import {
    getRoutePath,
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

    private readonly searchDebounceTimeoutId = signal<ReturnType<
        typeof setTimeout
    > | null>(null);
    private lastSyncedUrl: string | null = null;

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');

    constructor() {
        this.destroyRef.onDestroy(() => this.cancelPendingSearchApply());
        // Opening a settings search result navigates away from the typed
        // term; a keystroke still debouncing must not apply afterwards.
        this.destroyRef.onDestroy(
            inject(SettingsSearchService).onReveal(() =>
                this.cancelPendingSearchApply()
            )
        );

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

            const term = this.appliedSearchQuery();
            const url = this.routeState.currentUrl();
            const navigation = this.router.currentNavigation();
            // Wait for typing and navigation to settle: a q write must not
            // supersede scope clearing or recursively restart its own echo.
            if (this.searchDebounceTimeoutId() !== null || navigation) {
                return;
            }
            syncSearchQueryParam(this.router, url, term);
        });
    }

    onSearchInput(value: string): void {
        this.searchQuery.set(value);
        this.scheduleSearchApply(value);
    }

    syncSearchFromRoute(): void {
        this.syncSearchFromUrl(this.routeState.currentUrl());
    }

    /**
     * Adopts a term from outside the input box (URL `q`, command palette) into
     * both signals. The trim keeps the applied-terms-are-always-trimmed
     * invariant structural for URL-sourced values too: an externally crafted
     * `?q=Bein%20` must not put an untrimmed term into `appliedSearchQuery`,
     * or the URL-sync effect's trimmed rewrite would fail the echo guard's
     * equality check and snap the box — the same eaten-keystroke cycle the
     * guard exists to prevent — while the portal stores dispatch twice.
     */
    setSearchState(value: string): void {
        this.cancelPendingSearchApply();
        const trimmed = value.trim();
        this.searchQuery.set(trimmed);
        this.appliedSearchQuery.set(trimmed);
    }

    /**
     * Applies a term now, always in its trimmed form: the URL sync and the
     * portal stores only ever act on the trimmed term, and an untrimmed
     * applied term would make the router echo of our own `q` look like
     * foreign search intent. The box (`searchQuery`) keeps what was actually
     * typed, trailing whitespace included. This supersedes a queued debounce
     * — pressing Enter commits the term, and the keystroke that is still
     * waiting must not reapply the older one behind it.
     */
    applySearchQuery(value: string): void {
        this.cancelPendingSearchApply();
        this.appliedSearchQuery.set(value.trim());
    }

    private syncSearchFromUrl(url: string): void {
        const previousUrl = this.lastSyncedUrl;
        this.lastSyncedUrl = url;

        const nextTerm = parseWorkspaceShellRoute(url).usesQuerySearch
            ? getRouteQueryParam(this.router, url, 'q')
            : '';

        // An app-initiated navigation that stays on the same page and carries
        // the term we already applied brings no search intent of its own: it is
        // either an unrelated query param the page wrote (a filter chip, a
        // refresh bump) or the router echoing back our own `q`. Syncing anyway
        // would cancel the pending debounce and reset the box to the applied
        // term, silently eating everything typed since — the whole word when
        // the first keystroke has not been applied yet, or just-typed trailing
        // whitespace once the debounce has fired ("Bein " snaps to "Bein" and
        // typing on yields "BeinSports"). Applied terms are always trimmed, so
        // the echoed `q` compares directly.
        //
        // The trigger check keeps that narrow: history is always authoritative,
        // so back/forward re-applies what the entry carries even mid-typing.
        // `lastSuccessfulNavigation` is set immediately before `NavigationEnd`
        // is emitted, so it describes the navigation being handled here.
        //
        // The comparison trims `nextTerm` because adoption would too: a URL
        // still carrying a not-yet-rewritten untrimmed `q` adopts to exactly
        // the applied state, so syncing could only cancel a pending debounce.
        const navigation = this.router.lastSuccessfulNavigation();
        // Scope clearing carries the raw input's normalized term, even before
        // its debounce applies. The transient intent never survives history.
        const clearingScope =
            navigation?.extras.info === CATEGORY_SCOPE_CLEAR_NAVIGATION;
        const samePageEcho =
            previousUrl !== null &&
            getRoutePath(url) === getRoutePath(previousUrl) &&
            nextTerm.trim() === this.appliedSearchQuery();
        if (
            navigation?.trigger === 'imperative' &&
            (clearingScope || samePageEcho)
        ) {
            return;
        }

        this.setSearchState(nextTerm);
    }

    private scheduleSearchApply(value: string): void {
        this.cancelPendingSearchApply();
        this.searchDebounceTimeoutId.set(
            setTimeout(() => {
                this.searchDebounceTimeoutId.set(null);
                this.applySearchQuery(value);
            }, SEARCH_INPUT_DEBOUNCE_MS)
        );
    }

    private cancelPendingSearchApply(): void {
        const timeoutId = this.searchDebounceTimeoutId();
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            this.searchDebounceTimeoutId.set(null);
        }
    }
}
