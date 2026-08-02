import { encodeStalkerCmdValue } from '@iptvnator/shared/interfaces';

/**
 * Builds the full Stalker portal request URL from an already-validated portal
 * URL and the prepared request params.
 *
 * The query string is assembled manually because the two parameter classes
 * need different encodings:
 *
 * - `cmd` uses the minimal reference encoding (`encodeStalkerCmdValue`): a
 *   real MAG sends cmd unencoded and the portal decodes the query exactly
 *   once, so pre-encoded sequences (`%3A`) must pass through untouched while
 *   `&`/`#`/`;` are still escaped so a malicious portal cannot append query
 *   parameters through cmd.
 * - every other param is fully `encodeURIComponent`-encoded.
 *
 * Any query string on the portal URL itself is intentionally dropped (the
 * request params are the complete query), matching long-standing behavior.
 */
export function buildStalkerRequestUrl(
    url: string,
    requestParams: Record<string, string | number>
): string {
    const urlObject = new URL(url);
    const queryParts: string[] = [];

    Object.entries(requestParams).forEach(([key, value]) => {
        if (key === 'cmd') {
            queryParts.push(`${key}=${encodeStalkerCmdValue(String(value))}`);
        } else {
            queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
        }
    });

    // Always add JsHttpRequest parameter if not present (required by Stalker API)
    if (!requestParams['JsHttpRequest']) {
        queryParts.push('JsHttpRequest=1-xml');
    }

    return `${urlObject.origin}${urlObject.pathname}?${queryParts.join('&')}`;
}
