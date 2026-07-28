import {
    XTREAM_PRELOAD_PERFORMANCE_METHOD,
    XtreamCodeActions,
    type XtreamPreloadPerformanceCategoryType,
    type XtreamPreloadPerformanceContentType,
    type XtreamPreloadPerformanceMarker,
    type XtreamPreloadPerformanceMethod,
} from '@iptvnator/shared/interfaces';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_ITEM_COUNT = 1_000_000;
const ALLOWED_ACTIONS = new Set<string>(Object.values(XtreamCodeActions));
const ALLOWED_CATEGORY_TYPES = new Set(['live', 'movies', 'series']);
const ALLOWED_CONTENT_TYPES = new Set(['live', 'movie', 'series']);

export type XtreamPreloadMarkerMetadata = Pick<
    XtreamPreloadPerformanceMarker,
    | 'action'
    | 'categoryType'
    | 'contentType'
    | 'itemCount'
    | 'operationId'
    | 'playlistId'
    | 'sessionId'
>;

function readValue(value: unknown, property: PropertyKey): unknown {
    if (
        (typeof value !== 'object' || value === null) &&
        typeof value !== 'function'
    ) {
        return undefined;
    }

    try {
        return Reflect.get(value, property);
    } catch {
        return undefined;
    }
}

function readArgument(args: readonly unknown[], index: number): unknown {
    return readValue(args, index);
}

function normalizeIdentifier(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    return value.length >= 1 &&
        value.length <= MAX_IDENTIFIER_LENGTH &&
        IDENTIFIER_PATTERN.test(value)
        ? value
        : null;
}

function normalizeAction(value: unknown): XtreamCodeActions | null {
    return typeof value === 'string' && ALLOWED_ACTIONS.has(value)
        ? (value as XtreamCodeActions)
        : null;
}

function normalizeCategoryType(
    value: unknown
): XtreamPreloadPerformanceCategoryType | null {
    return typeof value === 'string' && ALLOWED_CATEGORY_TYPES.has(value)
        ? (value as XtreamPreloadPerformanceCategoryType)
        : null;
}

function normalizeContentType(
    value: unknown
): XtreamPreloadPerformanceContentType | null {
    return typeof value === 'string' && ALLOWED_CONTENT_TYPES.has(value)
        ? (value as XtreamPreloadPerformanceContentType)
        : null;
}

function readArrayCount(value: unknown): number | null {
    let isArray = false;
    try {
        isArray = Array.isArray(value);
    } catch {
        return null;
    }
    if (!isArray) {
        return null;
    }

    const length = readValue(value, 'length');
    return typeof length === 'number' &&
        Number.isSafeInteger(length) &&
        length >= 0 &&
        length <= MAX_ITEM_COUNT
        ? length
        : null;
}

function sumArrayCounts(first: unknown, second: unknown): number | null {
    const firstCount = readArrayCount(first);
    const secondCount = readArrayCount(second);
    if (firstCount === null || secondCount === null) {
        return null;
    }

    const total = firstCount + secondCount;
    return Number.isSafeInteger(total) && total <= MAX_ITEM_COUNT
        ? total
        : null;
}

function emptyMetadata(): XtreamPreloadMarkerMetadata {
    return {
        action: null,
        categoryType: null,
        contentType: null,
        itemCount: null,
        operationId: null,
        playlistId: null,
        sessionId: null,
    };
}

export function extractXtreamPreloadPerformanceMetadata(
    method: XtreamPreloadPerformanceMethod,
    args: readonly unknown[]
): XtreamPreloadMarkerMetadata {
    const metadata = emptyMetadata();
    const first = readArgument(args, 0);

    switch (method) {
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.XTREAM_REQUEST: {
            const params = readValue(first, 'params');
            metadata.sessionId = normalizeIdentifier(
                readValue(first, 'sessionId')
            );
            metadata.action = normalizeAction(readValue(params, 'action'));
            return metadata;
        }
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.XTREAM_CANCEL_SESSION:
            metadata.sessionId = normalizeIdentifier(first);
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GET_CATEGORIES:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.categoryType = normalizeCategoryType(
                readArgument(args, 1)
            );
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SAVE_CATEGORIES:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.itemCount = readArrayCount(readArgument(args, 1));
            metadata.categoryType = normalizeCategoryType(
                readArgument(args, 2)
            );
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GET_CONTENT:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.contentType = normalizeContentType(readArgument(args, 1));
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SAVE_CONTENT:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.itemCount = readArrayCount(readArgument(args, 1));
            metadata.contentType = normalizeContentType(readArgument(args, 2));
            metadata.operationId = normalizeIdentifier(readArgument(args, 3));
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_DELETE_XTREAM_CONTENT:
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_DELETE_PLAYLIST:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.operationId = normalizeIdentifier(readArgument(args, 1));
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_RESTORE_XTREAM_USER_DATA:
            metadata.playlistId = normalizeIdentifier(first);
            metadata.itemCount = sumArrayCounts(
                readArgument(args, 1),
                readArgument(args, 2)
            );
            metadata.operationId = normalizeIdentifier(readArgument(args, 3));
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_SEARCH_CONTENT:
            metadata.playlistId = normalizeIdentifier(first);
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_CANCEL_OPERATION:
            metadata.operationId = normalizeIdentifier(first);
            return metadata;
        case XTREAM_PRELOAD_PERFORMANCE_METHOD.DB_GLOBAL_SEARCH:
            return metadata;
    }
}
