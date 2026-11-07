/**
 * Which sections of a source are imported: live channels vs on-demand
 * (VOD movies + series together). Absent flags mean "import", so sources
 * stored before this existed keep their full catalog.
 */
export interface PlaylistImportScope {
    importLive?: boolean;
    importVod?: boolean;
}

export interface NormalizedPlaylistImportScope {
    importLive: boolean;
    importVod: boolean;
}

export function shouldImportLive(
    source: PlaylistImportScope | null | undefined
): boolean {
    return source?.importLive !== false;
}

export function shouldImportVod(
    source: PlaylistImportScope | null | undefined
): boolean {
    return source?.importVod !== false;
}

/**
 * Normalizes a scope so at least one section stays on: a source that
 * imports nothing is a broken source, so clearing the last checked box
 * re-checks it instead.
 */
export function normalizeImportScope(
    scope: PlaylistImportScope | null | undefined
): NormalizedPlaylistImportScope {
    const importLive = shouldImportLive(scope);
    const importVod = shouldImportVod(scope);
    if (!importLive && !importVod) {
        return { importLive: true, importVod: true };
    }
    return { importLive, importVod };
}

/** True when the scope disables at least one section. */
export function hasPartialImportScope(
    source: PlaylistImportScope | null | undefined
): boolean {
    return !shouldImportLive(source) || !shouldImportVod(source);
}

/**
 * The flags a stored playlist carries for the scope: only opt-outs are
 * written, so full-scope rows stay exactly as they were before scopes
 * existed and legacy readers keep working.
 */
export function storedImportScopeFlags(
    scope: PlaylistImportScope | null | undefined
): { importLive?: false; importVod?: false } {
    const { importLive, importVod } = normalizeImportScope(scope);
    return {
        ...(importLive ? {} : { importLive: false as const }),
        ...(importVod ? {} : { importVod: false as const }),
    };
}
