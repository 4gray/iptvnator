import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { WorkspaceSearchCapability } from '@iptvnator/workspace/shell/util';
import {
    SEARCH_LOADED_ONLY_STATUS,
    SEARCH_PLAYLIST_PLACEHOLDER,
} from './helpers/workspace-shell-constants';
import {
    resolveSearchPlaceholderKey,
    resolveSearchScopeLabel,
} from './helpers/workspace-shell-search-labels';
import { isWorkspaceGlobalSearchablePlaylist } from './helpers/workspace-shell-searchable-playlists';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';

@Injectable()
export class WorkspaceShellSearchService {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly routeState = inject(WorkspaceShellRouteStateService);
    private readonly searchSync = inject(WorkspaceShellSearchSyncService);

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly searchQuery = this.searchSync.searchQuery;
    readonly appliedSearchQuery = this.searchSync.appliedSearchQuery;
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

        if (route.kind === 'global-search') {
            const hasSearchablePlaylists =
                this.runtime.isElectron &&
                this.routeState
                    .playlists()
                    .some(isWorkspaceGlobalSearchablePlaylist);

            return {
                enabled: hasSearchablePlaylists,
                behavior: hasSearchablePlaylists ? 'remote-search' : 'disabled',
                context: null,
                section: null,
                searchMode: hasSearchablePlaylists ? 'remote-search' : 'none',
                placeholderKey: 'WORKSPACE.SHELL.SEARCH_GLOBAL_PLACEHOLDER',
                scopeLabel: this.translateText(
                    'WORKSPACE.SHELL.RAIL_GLOBAL_SEARCH'
                ),
                statusLabel: '',
                minLength: hasSearchablePlaylists ? 2 : 0,
                advancedRouteTarget: null,
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

    onSearchInput(value: string): void {
        this.searchSync.onSearchInput(value);
    }

    onSearchEnter(value: string): void {
        const trimmedValue = value.trim();
        this.searchQuery.set(trimmedValue);

        if (this.searchCapability().behavior === 'advanced-only') {
            const advancedRouteTarget =
                this.searchCapability().advancedRouteTarget;
            if (!advancedRouteTarget) {
                this.searchSync.applySearchQuery(trimmedValue);
                return;
            }

            this.xtreamStore.setSearchTerm(trimmedValue);
            this.searchSync.applySearchQuery(trimmedValue);
            void this.router.navigate(advancedRouteTarget, {
                queryParams: trimmedValue ? { q: trimmedValue } : {},
            });
            return;
        }

        this.searchSync.applySearchQuery(trimmedValue);
    }

    openPlaylistSearchFromPalette(query: string): void {
        const effectiveContext =
            this.routeState.dashboardXtreamContext() ??
            this.routeState.currentContext();

        if (!effectiveContext) {
            return;
        }

        this.searchSync.setSearchState(query);

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

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
