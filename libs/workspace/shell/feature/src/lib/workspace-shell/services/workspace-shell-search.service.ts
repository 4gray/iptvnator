import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter, startWith } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    parseWorkspaceShellRoute,
    WorkspaceSearchCapability,
} from '@iptvnator/workspace/shell/util';
import {
    SEARCH_INPUT_DEBOUNCE_MS,
    SEARCH_LOADED_ONLY_STATUS,
    SEARCH_PLAYLIST_PLACEHOLDER,
} from './helpers/workspace-shell-constants';
import {
    getRouteQueryParam,
    syncSearchQueryParam,
} from './helpers/workspace-shell-route-utils';
import {
    resolveSearchPlaceholderKey,
    resolveSearchScopeLabel,
} from './helpers/workspace-shell-search-labels';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';

@Injectable()
export class WorkspaceShellSearchService {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly translate = inject(TranslateService);
    private readonly routeState = inject(WorkspaceShellRouteStateService);

    private searchDebounceTimeoutId: ReturnType<typeof setTimeout> | null =
        null;
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');
    readonly searchCapability = computed<WorkspaceSearchCapability>(() => {
        this.languageTick();

        const route = this.routeState.currentRoute();
        const context = route.context;
        const section = route.section;
        const appliedQuery = this.appliedSearchQuery().trim();

        if (route.kind === 'settings') {
            return {
                enabled: false,
                behavior: 'disabled',
                context: null,
                section: null,
                searchMode: 'none',
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: '',
                statusLabel: '',
                minLength: 0,
                advancedRouteTarget: null,
            };
        }

        if (route.kind === 'dashboard') {
            const dashboardContext = this.routeState.dashboardXtreamContext();

            return {
                enabled: Boolean(dashboardContext),
                behavior: dashboardContext ? 'advanced-only' : 'disabled',
                context: dashboardContext,
                section: section,
                searchMode: dashboardContext ? 'advanced-only' : 'none',
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: dashboardContext
                    ? this.translateText('WORKSPACE.SHELL.RAIL_SEARCH')
                    : '',
                statusLabel: '',
                minLength: dashboardContext ? 1 : 0,
                advancedRouteTarget: dashboardContext
                    ? [
                          '/workspace',
                          'xtreams',
                          dashboardContext.playlistId,
                          'search',
                      ]
                    : null,
            };
        }

        if (route.searchMode === 'none') {
            return {
                enabled: false,
                behavior: 'disabled',
                context,
                section,
                searchMode: route.searchMode,
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: '',
                statusLabel: '',
                minLength: 0,
                advancedRouteTarget: null,
            };
        }

        const isDegradedStalkerItv =
            context?.provider === 'stalker' &&
            section === 'itv' &&
            appliedQuery.length > 0;
        const behavior = isDegradedStalkerItv
            ? 'degraded-loaded-only'
            : route.searchMode;

        return {
            enabled: true,
            behavior,
            context,
            section,
            searchMode: route.searchMode,
            placeholderKey: resolveSearchPlaceholderKey(
                route.kind,
                context,
                section
            ),
            scopeLabel: resolveSearchScopeLabel({
                kind: route.kind,
                context,
                section,
                translate: (key, params) => this.translateText(key, params),
                xtreamCategory: this.xtreamStore.getSelectedCategory(),
                stalkerCategoryName:
                    this.stalkerStore.getSelectedCategoryName(),
            }),
            statusLabel: isDegradedStalkerItv
                ? this.translateText(SEARCH_LOADED_ONLY_STATUS)
                : '',
            minLength: route.searchMode === 'remote-search' ? 3 : 1,
            advancedRouteTarget: null,
        };
    });
    readonly canUseSearch = computed(() => this.searchCapability().enabled);
    readonly searchPlaceholder = computed(
        () => this.searchCapability().placeholderKey
    );
    readonly searchScopeLabel = computed(
        () => this.searchCapability().scopeLabel
    );
    readonly searchStatusLabel = computed(
        () => this.searchCapability().statusLabel
    );

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

    onSearchEnter(value: string): void {
        const trimmedValue = value.trim();
        this.searchQuery.set(trimmedValue);

        if (this.searchCapability().behavior === 'advanced-only') {
            const advancedRouteTarget =
                this.searchCapability().advancedRouteTarget;
            if (!advancedRouteTarget) {
                this.applySearchQuery(trimmedValue);
                return;
            }

            this.xtreamStore.setSearchTerm(trimmedValue);
            this.applySearchQuery(trimmedValue);
            void this.router.navigate(advancedRouteTarget, {
                queryParams: trimmedValue ? { q: trimmedValue } : {},
            });
            return;
        }

        this.applySearchQuery(trimmedValue);
    }

    openPlaylistSearchFromPalette(query: string): void {
        const effectiveContext =
            this.routeState.dashboardXtreamContext() ??
            this.routeState.currentContext();

        if (!effectiveContext) {
            return;
        }

        this.searchQuery.set(query);
        this.appliedSearchQuery.set(query);

        if (effectiveContext.provider === 'xtreams') {
            this.xtreamStore.setSearchTerm(query);
            void this.router.navigate(
                [
                    '/workspace',
                    'xtreams',
                    effectiveContext.playlistId,
                    'search',
                ],
                {
                    queryParams: query ? { q: query } : {},
                }
            );
            return;
        }

        if (effectiveContext.provider === 'stalker') {
            void this.router.navigate(
                [
                    '/workspace',
                    'stalker',
                    effectiveContext.playlistId,
                    'search',
                ],
                {
                    queryParams: query ? { q: query } : {},
                }
            );
        }
    }

    syncSearchFromRoute(): void {
        this.syncSearchFromUrl(this.routeState.currentUrl());
    }

    private syncSearchFromUrl(url: string): void {
        if (parseWorkspaceShellRoute(url).usesQuerySearch) {
            this.setSearchState(getRouteQueryParam(this.router, url, 'q'));
            return;
        }

        this.setSearchState('');
    }

    private setSearchState(value: string): void {
        if (this.searchDebounceTimeoutId !== null) {
            clearTimeout(this.searchDebounceTimeoutId);
            this.searchDebounceTimeoutId = null;
        }

        this.searchQuery.set(value);
        this.appliedSearchQuery.set(value);
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

    private applySearchQuery(value: string): void {
        this.appliedSearchQuery.set(value);
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
