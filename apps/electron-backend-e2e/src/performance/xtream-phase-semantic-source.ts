import { XtreamCodeActions } from '@iptvnator/shared/interfaces';

import {
    XTREAM_PHASE_SEMANTIC_TYPE as SEMANTIC,
    type XtreamPhaseSemanticType,
} from './xtream-phase-inventory';

export type XtreamPhaseCategoryType = 'live' | 'movies' | 'series';
export type XtreamPhaseContentType = 'live' | 'movie' | 'series';
export type XtreamPhaseProviderAction =
    | XtreamCodeActions.GetAccountInfo
    | XtreamCodeActions.GetLiveCategories
    | XtreamCodeActions.GetLiveStreams
    | XtreamCodeActions.GetSeries
    | XtreamCodeActions.GetSeriesCategories
    | XtreamCodeActions.GetVodCategories
    | XtreamCodeActions.GetVodStreams;

export interface XtreamPhaseSemanticSource {
    readonly categoryType: XtreamPhaseCategoryType | null;
    readonly contentType: XtreamPhaseContentType | null;
    readonly providerAction: XtreamPhaseProviderAction | null;
}

const ACTION_SEMANTICS = new Map<string, XtreamPhaseSemanticType>([
    [XtreamCodeActions.GetAccountInfo, SEMANTIC.ACCOUNT],
    [XtreamCodeActions.GetLiveCategories, SEMANTIC.LIVE_CATEGORIES],
    [XtreamCodeActions.GetVodCategories, SEMANTIC.VOD_CATEGORIES],
    [XtreamCodeActions.GetSeriesCategories, SEMANTIC.SERIES_CATEGORIES],
    [XtreamCodeActions.GetLiveStreams, SEMANTIC.LIVE_CONTENT],
    [XtreamCodeActions.GetVodStreams, SEMANTIC.VOD_CONTENT],
    [XtreamCodeActions.GetSeries, SEMANTIC.SERIES_CONTENT],
]);
const CATEGORY_SEMANTICS = new Map<string, XtreamPhaseSemanticType>([
    ['live', SEMANTIC.LIVE_CATEGORIES],
    ['movies', SEMANTIC.VOD_CATEGORIES],
    ['series', SEMANTIC.SERIES_CATEGORIES],
]);
const CONTENT_SEMANTICS = new Map<string, XtreamPhaseSemanticType>([
    ['live', SEMANTIC.LIVE_CONTENT],
    ['movie', SEMANTIC.VOD_CONTENT],
    ['series', SEMANTIC.SERIES_CONTENT],
]);

export function semanticTypeFromXtreamPhaseSource(
    source: Readonly<Record<keyof XtreamPhaseSemanticSource, unknown>>
): XtreamPhaseSemanticType | null | undefined {
    const populated = [
        source.providerAction,
        source.categoryType,
        source.contentType,
    ].filter((value) => value !== null);
    if (populated.length === 0) return null;
    if (populated.length !== 1) return undefined;
    if (source.providerAction !== null) {
        return typeof source.providerAction === 'string'
            ? ACTION_SEMANTICS.get(source.providerAction)
            : undefined;
    }
    if (source.categoryType !== null) {
        return typeof source.categoryType === 'string'
            ? CATEGORY_SEMANTICS.get(source.categoryType)
            : undefined;
    }
    return typeof source.contentType === 'string'
        ? CONTENT_SEMANTICS.get(source.contentType)
        : undefined;
}

export function xtreamDataSemanticSource(
    semanticType: XtreamPhaseSemanticType | null
): XtreamPhaseSemanticSource {
    switch (semanticType) {
        case SEMANTIC.LIVE_CATEGORIES:
            return source(null, 'live', null);
        case SEMANTIC.VOD_CATEGORIES:
            return source(null, 'movies', null);
        case SEMANTIC.SERIES_CATEGORIES:
            return source(null, 'series', null);
        case SEMANTIC.LIVE_CONTENT:
            return source(null, null, 'live');
        case SEMANTIC.VOD_CONTENT:
            return source(null, null, 'movie');
        case SEMANTIC.SERIES_CONTENT:
            return source(null, null, 'series');
        case SEMANTIC.ACCOUNT:
            throw new Error('account has no database semantic source');
        case null:
            return source(null, null, null);
    }
}

export function xtreamProviderSemanticSource(
    semanticType: XtreamPhaseSemanticType
): XtreamPhaseSemanticSource {
    const action = [...ACTION_SEMANTICS].find(
        ([, mapped]) => mapped === semanticType
    )?.[0];
    if (!action) throw new Error('invalid provider semantic type');
    return source(action as XtreamPhaseProviderAction, null, null);
}

function source(
    providerAction: XtreamPhaseProviderAction | null,
    categoryType: XtreamPhaseCategoryType | null,
    contentType: XtreamPhaseContentType | null
): XtreamPhaseSemanticSource {
    return Object.freeze({ categoryType, contentType, providerAction });
}
