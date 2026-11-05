import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import type { StalkerFavoriteItem } from './models/stalker-favorite-item.interface';
export function matchesFavoriteById(
    favorite: Partial<StalkerFavoriteItem>,
    itemId: string | number,
    context?: StalkerPortalItem
): boolean {
    const reference = context && stalkerFavoriteReference(context);
    const candidate =
        reference && stalkerFavoriteReference(favorite as StalkerPortalItem);
    if (
        reference &&
        candidate &&
        favoriteReferenceKey(reference) !== favoriteReferenceKey(candidate)
    )
        return false;
    const expectedId = normalizeStalkerEntityId(itemId);
    return (
        normalizeStalkerEntityId(favorite?.id) === expectedId ||
        normalizeStalkerEntityId(favorite?.movie_id) === expectedId ||
        normalizeStalkerEntityId(favorite?.stream_id) === expectedId ||
        normalizeStalkerEntityId(favorite?.series_id) === expectedId
    );
}

export function normalizeStalkerEntityId(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}
