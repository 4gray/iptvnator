import type { CollectionContentType } from '../collection/unified-collection-item.interface';
import type { CollectionScope } from '../collection/scope-toggle.service';

export const COLLECTION_VIEW_STATE_KEY = 'collectionViewState';
/** One-use file:// reload handoff; never a persisted collection preference. */
export const COLLECTION_RELOAD_STATE_KEY =
    'iptvnator:renderer-reload-collection';

export interface CollectionViewState {
    selectedContentType?: CollectionContentType;
    scope?: CollectionScope;
}

export function buildCollectionViewState(params: {
    selectedContentType?: CollectionContentType | null;
    scope?: CollectionScope | null;
}): CollectionViewState | null {
    const selectedContentType = normalizeCollectionContentType(
        params.selectedContentType
    );
    const scope = normalizeCollectionScope(params.scope);

    if (!selectedContentType && !scope) {
        return null;
    }

    return {
        ...(selectedContentType ? { selectedContentType } : {}),
        ...(scope ? { scope } : {}),
    };
}

export function getCollectionViewState(
    state: unknown
): CollectionViewState | null {
    const record = toStateRecord(state);
    const candidate = toStateRecord(record?.[COLLECTION_VIEW_STATE_KEY]);

    return buildCollectionViewState({
        selectedContentType: candidate?.[
            'selectedContentType'
        ] as CollectionContentType | null,
        scope: candidate?.['scope'] as CollectionScope | null,
    });
}

function normalizeCollectionContentType(
    value: CollectionContentType | null | undefined
): CollectionContentType | null {
    return value === 'live' || value === 'movie' || value === 'series'
        ? value
        : null;
}

function normalizeCollectionScope(
    value: CollectionScope | null | undefined
): CollectionScope | null {
    return value === 'playlist' || value === 'all' ? value : null;
}

function toStateRecord(state: unknown): Record<string, unknown> | null {
    return state && typeof state === 'object'
        ? (state as Record<string, unknown>)
        : null;
}
