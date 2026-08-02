import type { XtreamImportPhaseTone } from './workspace-shell-constants';
import type { TranslateFn } from './workspace-shell-search-labels';

export type XtreamImportContentType = 'live' | 'vod' | 'series' | null;
export type XtreamRefreshPreparationPhase =
    | 'collecting-user-data'
    | 'deleting-content'
    | 'deleting-categories'
    | string
    | null
    | undefined;

export function buildXtreamImportTypeLabel(
    contentType: XtreamImportContentType,
    translate: TranslateFn
): string {
    switch (contentType) {
        case 'live':
            return translate('WORKSPACE.SHELL.RAIL_LIVE');
        case 'vod':
            return translate('WORKSPACE.SHELL.RAIL_MOVIES');
        case 'series':
            return translate('WORKSPACE.SHELL.RAIL_SERIES');
        default:
            return '';
    }
}

export function buildXtreamImportPhaseTone(
    phase: string | null | undefined
): XtreamImportPhaseTone {
    switch (phase) {
        case 'loading-categories':
        case 'loading-live':
        case 'loading-movies':
        case 'loading-series':
            return 'remote';
        case 'loading-cached':
        case 'preparing-content':
        case 'saving-categories':
        case 'saving-content':
        case 'restoring-favorites':
        case 'restoring-recently-viewed':
            return 'local';
        default:
            return null;
    }
}

export function buildXtreamRefreshPreparationPhaseLabel(
    phase: XtreamRefreshPreparationPhase,
    translate: TranslateFn
): string {
    switch (phase) {
        case 'collecting-user-data':
            return translate('WORKSPACE.SHELL.XTREAM_REFRESH_COLLECTING_DATA');
        case 'deleting-content':
            return translate('WORKSPACE.SHELL.XTREAM_REFRESH_DELETING_CONTENT');
        case 'deleting-categories':
            return translate(
                'WORKSPACE.SHELL.XTREAM_REFRESH_DELETING_CATEGORIES'
            );
        default:
            return translate('WORKSPACE.SHELL.XTREAM_REFRESH_COLLECTING_DATA');
    }
}

export function buildXtreamImportSourceLabel(
    tone: XtreamImportPhaseTone,
    translate: TranslateFn
): string {
    if (tone === 'remote') {
        return translate('WORKSPACE.SHELL.XTREAM_IMPORT_REMOTE_BADGE');
    }
    if (tone === 'local') {
        return translate('WORKSPACE.SHELL.XTREAM_IMPORT_LOCAL_BADGE');
    }
    return '';
}

export function buildXtreamImportPhaseLabel(
    phase: string | null | undefined,
    translate: TranslateFn
): string {
    switch (phase) {
        case 'loading-cached':
            return translate('WORKSPACE.SHELL.XTREAM_IMPORT_LOADING_CACHED');
        case 'preparing-content':
            return translate('WORKSPACE.SHELL.XTREAM_IMPORT_PREPARING');
        case 'loading-categories':
        case 'loading-live':
        case 'loading-movies':
        case 'loading-series':
            return translate('WORKSPACE.SHELL.XTREAM_IMPORT_LOADING');
        case 'saving-categories':
        case 'saving-content':
            return translate('WORKSPACE.SHELL.XTREAM_IMPORT_SAVING');
        case 'restoring-favorites':
            return translate(
                'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_FAVORITES'
            );
        case 'restoring-recently-viewed':
            return translate('WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_RECENT');
        default:
            return '';
    }
}

export function buildXtreamImportDetailLabel(
    phase: string | null | undefined,
    tone: XtreamImportPhaseTone,
    translate: TranslateFn
): string {
    // Reading the already-imported catalog from SQLite is a local phase, but
    // the generic local detail ("prepares faster switches next time") would
    // misdescribe it — the cache is what is being read, not built.
    if (phase === 'loading-cached') {
        return translate('WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_CACHED');
    }
    if (tone === 'remote') {
        return translate('WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_REMOTE');
    }
    if (tone === 'local') {
        return translate('WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_LOCAL');
    }
    return '';
}

export function buildXtreamImportProgressLabel(
    typeLabel: string,
    currentCount: number,
    totalCount: number,
    translate: TranslateFn,
    formatNumber: (value: number) => string
): string {
    if (!typeLabel || totalCount === 0) {
        return '';
    }

    return translate('WORKSPACE.SHELL.XTREAM_IMPORT_PROGRESS', {
        type: typeLabel,
        current: formatNumber(currentCount),
        total: formatNumber(totalCount),
    });
}

export function buildXtreamRefreshPreparationProgressLabel(
    currentCount: number,
    totalCount: number,
    translate: TranslateFn,
    formatNumber: (value: number) => string
): string {
    if (totalCount === 0) {
        return '';
    }

    return translate('WORKSPACE.SHELL.XTREAM_REFRESH_PROGRESS', {
        current: formatNumber(currentCount),
        total: formatNumber(totalCount),
    });
}

export function formatLocalizedNumber(
    value: number,
    currentLang: string | null | undefined,
    defaultLang: string | null | undefined
): string {
    const locale = currentLang || defaultLang || 'en';
    return new Intl.NumberFormat(locale).format(value);
}
