import type { ContentType } from '../../xtream-state';
import type {
    ParentSelectionStoreLike,
    XtreamSelectionCategory,
} from './with-selection.models';

/**
 * The category `categoryId` names, looked up in the selected type's list
 * first. PWA categories are raw provider rows whose ids are per type (a VOD
 * "5" and a live "5"); the other lists answer only when that one has no
 * match, as before. Electron rows carry unique SQLite ids either way.
 */
export function findSelectedCategory(
    store: ParentSelectionStoreLike,
    contentType: ContentType,
    categoryId: string | number
): XtreamSelectionCategory | undefined {
    const byType: Record<ContentType, XtreamSelectionCategory[]> = {
        vod: store.vodCategories?.() || [],
        live: store.liveCategories?.() || [],
        series: store.serialCategories?.() || [],
    };
    const matches = (category: XtreamSelectionCategory) =>
        category.id === categoryId ||
        category.category_id === String(categoryId);
    return (
        byType[contentType]?.find(matches) ??
        [...byType.vod, ...byType.live, ...byType.series].find(matches)
    );
}
