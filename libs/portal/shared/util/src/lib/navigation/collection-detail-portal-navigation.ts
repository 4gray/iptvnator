import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import {
    buildStalkerDetailNavigationTarget,
    buildStalkerStateItem,
    buildXtreamNavigationTarget,
    WorkspaceNavigationTarget,
} from './workspace-portal-navigation';
import { StalkerPortalItem } from '@iptvnator/shared/interfaces';

/**
 * Builds the portal-detail target for a collection item, or `null` when no
 * exact detail route can be formed. Unlike `getUnifiedCollectionNavigation`
 * this never degrades to a category- or section-only route: the caller shows
 * a "View in portal" affordance only when the jump lands on the item itself.
 */
export function getUnifiedCollectionDetailNavigation(
    item: UnifiedCollectionItem,
    options?: { returnTo?: string | null }
): WorkspaceNavigationTarget | null {
    if (item.contentType === 'live') {
        return null;
    }

    if (item.sourceType === 'xtream') {
        const categoryId = toTrimmedSegment(item.categoryId);
        const itemId =
            toPositiveIntegerSegment(item.xtreamId) ??
            toPositiveIntegerSegment(lastUidSegment(item.uid));
        if (!categoryId || !itemId) {
            return null;
        }

        return buildXtreamNavigationTarget({
            playlistId: item.playlistId,
            type: item.contentType,
            categoryId,
            itemId,
            title: item.name,
            imageUrl: item.posterUrl ?? item.logo ?? null,
        });
    }

    if (item.sourceType === 'stalker') {
        return buildStalkerDetailNavigationTarget({
            playlistId: item.playlistId,
            type: item.contentType,
            categoryId: item.categoryId,
            item: buildStalkerStateItem(
                item.stalkerItem as StalkerPortalItem | undefined,
                {
                    id: item.stalkerId ?? lastUidSegment(item.uid) ?? '',
                    title: item.name,
                    type: item.contentType,
                    category_id: item.categoryId,
                    poster_url: item.posterUrl ?? item.logo ?? undefined,
                }
            ),
            returnTo: options?.returnTo ?? null,
        });
    }

    return null;
}

function toTrimmedSegment(value: unknown): string {
    return String(value ?? '').trim();
}

function toPositiveIntegerSegment(value: unknown): string | null {
    const parsed = Number(toTrimmedSegment(value));
    return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function lastUidSegment(uid: string): string | undefined {
    const segments = uid.split('::');
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
}
