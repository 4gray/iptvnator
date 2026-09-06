import { redactSensitiveData, REDACTED_VALUE } from '@iptvnator/shared/logging';

/** Shared redaction produces a bounded, acyclic plain-data tree. XMLTV feeds
 * can also put opaque secrets in arbitrary URL paths/query keys, so omit URLs
 * entirely from diagnostics (including redirects and malformed error URLs).
 * IPC progress and rejected errors keep their original values for callers.
 */
function omitUrls(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.replace(
            /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu,
            REDACTED_VALUE
        );
    }
    if (Array.isArray(value)) return value.map(omitUrls);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                omitUrls(key),
                omitUrls(entry),
            ])
        );
    }
    return value;
}

// Axios/Node transport objects also contain relative request paths and raw
// HTTP headers without a URL scheme. Never forward them or arbitrary error
// fields to the logger, even after generic redaction.
function summarizeError(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) =>
                [
                    'name',
                    'message',
                    'code',
                    'status',
                    'statusCode',
                    'cause',
                ].includes(key)
            )
            .map(([key, entry]) => [key, summarizeError(entry)])
    );
}

export const epgLogger = {
    log(...args: unknown[]): void {
        console.log(
            ...args.map((value) => omitUrls(redactSensitiveData(value)))
        );
    },
    error(...args: unknown[]): void {
        console.error(
            ...args.map((value) =>
                omitUrls(summarizeError(redactSensitiveData(value)))
            )
        );
    },
};
