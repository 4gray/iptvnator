import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';

/** Catalog-only visibility: never apply to Favorites, history or identity lookups. */
export function enabledXtreamCatalogCondition(
    playlistId: SQL | AnyColumn = schema.categories.playlistId,
    contentType: SQL | AnyColumn = schema.content.type
): SQL {
    return sql`EXISTS (
        SELECT 1 FROM playlists AS selection_source
        WHERE selection_source.id = ${playlistId}
        AND CASE WHEN json_valid(selection_source.payload) THEN
            CASE WHEN json_type(selection_source.payload, '$.xtreamContentTypes') = 'array'
            THEN EXISTS (
                SELECT 1 FROM json_each(selection_source.payload, '$.xtreamContentTypes') AS selected_type
                WHERE selected_type.value = ${contentType}
            ) ELSE 1 END
        ELSE 1 END
    )`;
}
