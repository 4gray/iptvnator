// The date guard excludes SQLite's non-deterministic 'now' from indexed rows.
export const RECENTLY_VIEWED_CHRONOLOGY =
    "CASE WHEN viewed_at GLOB '[0-9][0-9][0-9][0-9]-*' THEN julianday(viewed_at) END";
