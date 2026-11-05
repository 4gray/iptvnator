import { PortalWatchStateFilter } from '@iptvnator/portal/shared/util';

/** The Movies watch-status choices; null keeps the unfiltered catalog. */
export const CATALOG_WATCH_FILTER_OPTIONS: readonly {
    value: PortalWatchStateFilter;
    labelKey: string;
}[] = [
    { value: null, labelKey: 'WORKSPACE.REFINE_WATCH_ALL' },
    { value: 'unwatched', labelKey: 'WORKSPACE.REFINE_WATCH_UNWATCHED' },
    { value: 'in-progress', labelKey: 'WORKSPACE.REFINE_WATCH_IN_PROGRESS' },
    { value: 'watched', labelKey: 'WORKSPACE.REFINE_WATCH_WATCHED' },
];
