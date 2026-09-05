import type BetterSqlite3 from 'better-sqlite3';

/** Called inside the source-clear transaction, before deleting its provenance. */
export function restoreSurvivingChannelMetadata(
    db: BetterSqlite3.Database,
    sourceUrl: string
): void {
    // Existing global rows cannot be backfilled: their last metadata writer may
    // differ from source_url. Only imports recorded in the ledger prove origin.
    const survivingValue = (column: string) => `(
        SELECT ${column} FROM epg_channel_sources
        WHERE channel_id = epg_channels.id AND source_url != @sourceUrl
        ORDER BY updated_at DESC, source_url LIMIT 1
    )`;
    db.prepare(
        `
        UPDATE epg_channels SET
            display_name = COALESCE(${survivingValue('display_name')}, id),
            icon_url = ${survivingValue('icon_url')},
            url = ${survivingValue('url')},
            updated_at = ${survivingValue('updated_at')},
            source_url = COALESCE(${survivingValue('source_url')}, (
                SELECT source_url FROM epg_programs
                WHERE channel_id = epg_channels.id AND source_url != @sourceUrl
                ORDER BY source_url LIMIT 1
            ), @sourceUrl)
        WHERE source_url = @sourceUrl
            OR id IN (SELECT channel_id FROM epg_channel_sources WHERE source_url = @sourceUrl)
            OR id IN (SELECT channel_id FROM epg_programs WHERE source_url = @sourceUrl)
    `
    ).run({ sourceUrl });
}
