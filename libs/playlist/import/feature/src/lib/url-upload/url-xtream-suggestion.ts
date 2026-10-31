import {
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
    ProviderImportCandidate,
} from '@iptvnator/shared/interfaces';

export type UrlXtreamSuggestion = ProviderImportCandidate & {
    userAgent?: string;
};

/** A URL shape proposes a connection; only an API response can confirm it. */
export function suggestXtreamFromUrl(
    value: string
): UrlXtreamSuggestion | null {
    try {
        const url = new URL(value.trim());
        if (
            !/\/(?:get|player_api|panel_api)\.php\/?$/i.test(url.pathname) ||
            url.hash ||
            // Extra provider tokens cannot be carried by a standard Xtream
            // connection, so preserve those links as M3U without suggesting.
            [...url.searchParams.keys()].some(
                (key) =>
                    !['username', 'password', 'type', 'output'].includes(key)
            ) ||
            ['username', 'password'].some(
                (key) => url.searchParams.getAll(key).length !== 1
            )
        ) {
            return null;
        }
        const credentials = extractXtreamCredentialsFromUrl(value);
        if (!credentials) return null;
        return {
            kind: 'xtream',
            confidence: 'high',
            serverUrl: normalizeXtreamServerUrl(value),
            suggestedTitle: url.hostname,
            ...credentials,
        };
    } catch {
        return null;
    }
}
