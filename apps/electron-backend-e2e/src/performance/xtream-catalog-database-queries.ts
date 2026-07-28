export interface XtreamCatalogDatabaseQuery {
    readonly parameters: readonly (number | string)[];
    readonly sql: string;
}

const CATEGORY_PARTITIONS = [
    {
        categoryType: 'live',
        expectedName: 'Performance Live %02d',
        idBase: 91_100,
    },
    {
        categoryType: 'movies',
        expectedName: 'Performance VOD %02d',
        idBase: 92_100,
    },
    {
        categoryType: 'series',
        expectedName: 'Performance Series %02d',
        idBase: 93_100,
    },
] as const;

const CONTENT_PARTITIONS = [
    {
        categoryType: 'live',
        contentType: 'live',
        expectedTitle: 'Performance Live %06d',
        idBase: 999_999,
    },
    {
        categoryType: 'movies',
        contentType: 'movie',
        expectedTitle: 'Performance Movie %06d',
        idBase: 1_999_999,
    },
    {
        categoryType: 'series',
        contentType: 'series',
        expectedTitle: 'Performance Series %06d',
        idBase: 2_999_999,
    },
] as const;

const PLAYLIST_QUERY = `
    SELECT
        COUNT(*) AS playlistCount,
        COALESCE(SUM(CASE WHEN id = ? THEN 1 ELSE 0 END), 0)
            AS matchingPlaylistCount,
        MAX(CASE WHEN id = ? THEN type ELSE NULL END)
            AS matchingPlaylistType
    FROM playlists
`;

const CATEGORY_COUNT_QUERY = `
    SELECT COUNT(*) AS categoryCount
    FROM categories
    WHERE playlist_id = ?
`;

const CONTENT_COUNT_QUERY = `
    SELECT COUNT(*) AS contentCount
    FROM content AS item
    INNER JOIN categories AS category ON category.id = item.category_id
    WHERE category.playlist_id = ?
`;

const CATEGORY_PARTITION_QUERY = `
    SELECT
        COUNT(*) AS count,
        COUNT(DISTINCT xtream_id) AS distinctXtreamIdCount,
        COALESCE(
            SUM(CASE
                WHEN name <> printf(?, xtream_id - ?) THEN 1
                ELSE 0
            END),
            0
        ) AS invalidNameCount,
        MAX(xtream_id) AS maxXtreamId,
        MIN(xtream_id) AS minXtreamId
    FROM categories
    WHERE playlist_id = ? AND type = ?
`;

const CONTENT_PARTITION_QUERY = `
    SELECT
        COUNT(*) AS count,
        COUNT(DISTINCT item.xtream_id) AS distinctXtreamIdCount,
        (
            SELECT COUNT(*)
            FROM (
                SELECT expected_category.id
                FROM categories AS expected_category
                LEFT JOIN content AS expected_item
                    ON expected_item.category_id = expected_category.id
                    AND expected_item.type = ?
                WHERE expected_category.playlist_id = ?
                    AND expected_category.type = ?
                GROUP BY expected_category.id
                HAVING COUNT(expected_item.id) <> 1000
            )
        ) AS invalidCategoryCardinalityCount,
        COALESCE(
            SUM(CASE
                WHEN item.title <> printf(?, item.xtream_id - ?) THEN 1
                ELSE 0
            END),
            0
        ) AS invalidTitleCount,
        MAX(item.xtream_id) AS maxXtreamId,
        MIN(item.xtream_id) AS minXtreamId
    FROM content AS item
    INNER JOIN categories AS category ON category.id = item.category_id
    WHERE category.playlist_id = ?
        AND category.type = ?
        AND item.type = ?
`;

const IMPORT_STATUS_QUERY = `
    SELECT
        (SELECT value FROM app_state WHERE key = ?) AS live,
        (SELECT value FROM app_state WHERE key = ?) AS movie,
        (SELECT value FROM app_state WHERE key = ?) AS series
`;

export function buildXtreamCatalogDatabaseQueries(
    playlistId: string
): readonly XtreamCatalogDatabaseQuery[] {
    const queries: XtreamCatalogDatabaseQuery[] = [
        descriptor(PLAYLIST_QUERY, [playlistId, playlistId]),
        descriptor(CATEGORY_COUNT_QUERY, [playlistId]),
        descriptor(CONTENT_COUNT_QUERY, [playlistId]),
    ];
    for (const partition of CATEGORY_PARTITIONS) {
        queries.push(
            descriptor(CATEGORY_PARTITION_QUERY, [
                partition.expectedName,
                partition.idBase,
                playlistId,
                partition.categoryType,
            ])
        );
    }
    for (const partition of CONTENT_PARTITIONS) {
        queries.push(
            descriptor(CONTENT_PARTITION_QUERY, [
                partition.contentType,
                playlistId,
                partition.categoryType,
                partition.expectedTitle,
                partition.idBase,
                playlistId,
                partition.categoryType,
                partition.contentType,
            ])
        );
    }
    queries.push(
        descriptor(IMPORT_STATUS_QUERY, [
            importStatusKey(playlistId, 'live'),
            importStatusKey(playlistId, 'movie'),
            importStatusKey(playlistId, 'series'),
        ])
    );
    return Object.freeze(queries);
}

function descriptor(
    sql: string,
    parameters: readonly (number | string)[]
): XtreamCatalogDatabaseQuery {
    return Object.freeze({
        parameters: Object.freeze([...parameters]),
        sql,
    });
}

function importStatusKey(playlistId: string, type: string): string {
    return `xtream-import-status:${playlistId}:${type}`;
}
