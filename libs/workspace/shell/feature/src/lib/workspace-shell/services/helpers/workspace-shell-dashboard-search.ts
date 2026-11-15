import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    WorkspacePortalContext,
    WorkspaceSearchCapability,
} from '@iptvnator/workspace/shell/util';
import { SEARCH_PLAYLIST_PLACEHOLDER } from './workspace-shell-constants';

export const SEARCH_GLOBAL_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_GLOBAL_PLACEHOLDER';
/** The global search page, which the dashboard field hands its term to. */
export const GLOBAL_SEARCH_ROUTE: readonly string[] = ['/workspace', 'search'];

export interface DashboardSearchInput {
    /** The active Xtream source, when it is the dashboard's rail context. */
    xtreamContext: WorkspacePortalContext | null;
    section: PortalRailSection | null;
    /**
     * Global search is reachable: the desktop runtime (its route guard) and a
     * source global search can query.
     */
    canLaunchGlobalSearch: boolean;
    xtreamScopeLabel: string;
}

/**
 * The dashboard has no catalog of its own to filter, so its field is an entry
 * point into another search. An active Xtream source keeps its advanced
 * search; otherwise the desktop app launches global search. Without either
 * (the PWA has no global search) the capability is disabled and the header
 * leaves the field out rather than showing one that does nothing.
 */
export function resolveDashboardSearchCapability(
    input: DashboardSearchInput
): WorkspaceSearchCapability {
    const { xtreamContext, section } = input;

    if (xtreamContext) {
        return {
            enabled: true,
            behavior: 'advanced-only',
            context: xtreamContext,
            section,
            searchMode: 'advanced-only',
            placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
            scopeLabel: input.xtreamScopeLabel,
            statusLabel: '',
            minLength: 1,
            advancedRouteTarget: [
                '/workspace',
                'xtreams',
                xtreamContext.playlistId,
                'search',
            ],
        };
    }

    if (input.canLaunchGlobalSearch) {
        return {
            enabled: true,
            behavior: 'global-launcher',
            context: null,
            section,
            searchMode: 'advanced-only',
            placeholderKey: SEARCH_GLOBAL_PLACEHOLDER,
            scopeLabel: '',
            statusLabel: '',
            minLength: 1,
            advancedRouteTarget: GLOBAL_SEARCH_ROUTE,
        };
    }

    return {
        enabled: false,
        behavior: 'disabled',
        context: null,
        section,
        searchMode: 'none',
        placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
        scopeLabel: '',
        statusLabel: '',
        minLength: 0,
        advancedRouteTarget: null,
    };
}
