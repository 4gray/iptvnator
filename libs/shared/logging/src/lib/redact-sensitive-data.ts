export const REDACTED_VALUE = '[Redacted]';

const CIRCULAR_VALUE = '[Circular]';
const MAX_DEPTH_VALUE = '[MaxDepth]';
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_ARRAY_ITEMS = 50;
const DEFAULT_MAX_OBJECT_KEYS = 50;
const DEFAULT_MAX_STRING_LENGTH = 2_000;

const SENSITIVE_KEY_NAMES = new Set([
    'apikey',
    'auth',
    'authorization',
    'cookie',
    'credentials',
    'deviceid',
    'deviceid2',
    'login',
    'mac',
    'macaddress',
    'mpvplayerarguments',
    'passwd',
    'password',
    'pwd',
    'secret',
    'setcookie',
    'signature',
    'signature2',
    'sn',
    'token',
    'username',
    'vlcplayerarguments',
]);

const SENSITIVE_KEY_SUFFIXES = [
    'apikey',
    'authorization',
    'cookie',
    'macaddress',
    'passwd',
    'password',
    'secret',
    'token',
    'username',
];

const XTREAM_CREDENTIAL_PATH_SEGMENTS = new Set([
    'live',
    'movie',
    'series',
    'timeshift',
]);

export interface RedactionOptions {
    maxDepth?: number;
    maxArrayItems?: number;
    maxObjectKeys?: number;
    maxStringLength?: number;
}

interface ResolvedRedactionOptions {
    maxDepth: number;
    maxArrayItems: number;
    maxObjectKeys: number;
    maxStringLength: number;
}

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
    const normalized = normalizeKey(key);
    return (
        SENSITIVE_KEY_NAMES.has(normalized) ||
        SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    );
}

function resolveOptions(options: RedactionOptions): ResolvedRedactionOptions {
    return {
        maxDepth: Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH),
        maxArrayItems: Math.max(
            0,
            options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS
        ),
        maxObjectKeys: Math.max(
            0,
            options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS
        ),
        maxStringLength: Math.max(
            0,
            options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
        ),
    };
}

function truncateString(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    const omitted = value.length - maxLength;
    return `${value.slice(0, maxLength)}[Truncated ${omitted} chars]`;
}

function redactSearchParams(
    params: URLSearchParams,
    sanitizeValue: (value: string) => string
): URLSearchParams {
    const redacted = new URLSearchParams();

    params.forEach((value, key) => {
        redacted.append(
            key,
            isSensitiveKey(key) ? REDACTED_VALUE : sanitizeValue(value)
        );
    });

    return redacted;
}

function redactUrl(
    value: URL,
    sanitizeValue: (value: string) => string
): string {
    const redacted = new URL(value.toString());

    if (redacted.username) {
        redacted.username = REDACTED_VALUE;
    }
    if (redacted.password) {
        redacted.password = REDACTED_VALUE;
    }

    const pathSegments = redacted.pathname.split('/');
    for (let index = 0; index < pathSegments.length - 2; index += 1) {
        if (XTREAM_CREDENTIAL_PATH_SEGMENTS.has(pathSegments[index])) {
            pathSegments[index + 1] = REDACTED_VALUE;
            pathSegments[index + 2] = REDACTED_VALUE;
        }
    }
    redacted.pathname = pathSegments.join('/');

    const search = redactSearchParams(
        redacted.searchParams,
        sanitizeValue
    ).toString();
    redacted.search = search ? `?${search}` : '';

    const fragment = redacted.hash.slice(1);
    if (looksLikeSearchParams(fragment)) {
        const hash = redactSearchParams(
            new URLSearchParams(fragment),
            sanitizeValue
        ).toString();
        redacted.hash = hash ? `#${hash}` : '';
    }

    return redacted.toString();
}

function redactUrlStrings(
    value: string,
    sanitizeValue: (value: string) => string
): string {
    return value.replace(
        /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu,
        (candidate) => {
            try {
                return redactUrl(new URL(candidate), sanitizeValue);
            } catch {
                return candidate;
            }
        }
    );
}

function looksLikeSearchParams(value: string): boolean {
    return /^[^=&\s]+=[^&]*(?:&[^=&\s]+=[^&]*)*$/u.test(value);
}

export function redactSensitiveData(
    value: unknown,
    options: RedactionOptions = {}
): unknown {
    const resolved = resolveOptions(options);
    const seen = new WeakSet<object>();

    const visitString = (input: string, depth: number): string => {
        const trimmed = input.trim();

        if (depth >= resolved.maxDepth) {
            return MAX_DEPTH_VALUE;
        }

        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                return truncateString(
                    JSON.stringify(visit(JSON.parse(trimmed), depth + 1)),
                    resolved.maxStringLength
                );
            } catch {
                // Keep processing malformed or non-JSON diagnostic strings.
            }
        }

        if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
            try {
                return truncateString(
                    redactUrl(new URL(trimmed), (entry) =>
                        visitString(entry, depth + 1)
                    ),
                    resolved.maxStringLength
                );
            } catch {
                // Continue with embedded URL handling for malformed URLs.
            }
        }

        if (looksLikeSearchParams(trimmed)) {
            return truncateString(
                redactSearchParams(new URLSearchParams(trimmed), (entry) =>
                    visitString(entry, depth + 1)
                ).toString(),
                resolved.maxStringLength
            );
        }

        return truncateString(
            redactUrlStrings(input, (entry) => visitString(entry, depth + 1)),
            resolved.maxStringLength
        );
    };

    const visitObject = (
        input: Record<string, unknown>,
        depth: number
    ): Record<string, unknown> => {
        const output: Record<string, unknown> = {};
        const keys = Object.keys(input);

        for (const key of keys.slice(0, resolved.maxObjectKeys)) {
            if (isSensitiveKey(key)) {
                output[key] = REDACTED_VALUE;
                continue;
            }

            try {
                output[key] = visit(input[key], depth + 1);
            } catch {
                output[key] = '[Unserializable]';
            }
        }

        if (keys.length > resolved.maxObjectKeys) {
            output['__truncatedKeys'] = keys.length - resolved.maxObjectKeys;
        }

        return output;
    };

    const visitError = (
        error: Error,
        depth: number
    ): Record<string, unknown> => {
        const output = visitObject(
            error as Error & Record<string, unknown>,
            depth
        );
        output['name'] = visitString(error.name, depth + 1);
        output['message'] = visitString(error.message, depth + 1);
        if (error.stack) {
            const [, ...stackFrames] = error.stack.split('\n');
            output['stack'] = visitString(
                [`${output['name']}: ${output['message']}`, ...stackFrames].join(
                    '\n'
                ),
                depth + 1
            );
        }
        if ('cause' in error) {
            output['cause'] = visit(error.cause, depth + 1);
        }
        return output;
    };

    const visit = (input: unknown, depth: number): unknown => {
        if (
            input == null ||
            typeof input === 'boolean' ||
            typeof input === 'number'
        ) {
            return input;
        }
        if (typeof input === 'string') {
            return visitString(input, depth);
        }
        if (typeof input === 'bigint') {
            return input.toString();
        }
        if (typeof input === 'symbol') {
            return input.toString();
        }
        if (typeof input === 'function') {
            return undefined;
        }
        if (depth >= resolved.maxDepth) {
            return MAX_DEPTH_VALUE;
        }

        const object = input as object;
        if (seen.has(object)) {
            return CIRCULAR_VALUE;
        }
        seen.add(object);

        try {
            if (input instanceof URL) {
                return redactUrl(input, (entry) =>
                    visitString(entry, depth + 1)
                );
            }
            if (input instanceof URLSearchParams) {
                return redactSearchParams(input, (entry) =>
                    visitString(entry, depth + 1)
                ).toString();
            }
            if (input instanceof Error) {
                return visitError(input, depth);
            }
            if (input instanceof Date) {
                return Number.isNaN(input.getTime())
                    ? '[Invalid Date]'
                    : input.toISOString();
            }
            if (Array.isArray(input)) {
                const output = input
                    .slice(0, resolved.maxArrayItems)
                    .map((entry) => visit(entry, depth + 1));
                if (input.length > resolved.maxArrayItems) {
                    output.push(
                        `[Truncated ${
                            input.length - resolved.maxArrayItems
                        } items]`
                    );
                }
                return output;
            }
            if (input instanceof Map) {
                const entries: Record<string, unknown> = {};
                const mapEntries = Array.from(input).slice(
                    0,
                    resolved.maxObjectKeys
                );
                for (const [key, entry] of mapEntries) {
                    entries[visitString(String(key), depth + 1)] = visit(
                        entry,
                        depth + 1
                    );
                }
                if (input.size > resolved.maxObjectKeys) {
                    entries['__truncatedKeys'] =
                        input.size - resolved.maxObjectKeys;
                }
                return entries;
            }
            if (input instanceof Set) {
                return visit(Array.from(input), depth);
            }

            return visitObject(input as Record<string, unknown>, depth);
        } finally {
            seen.delete(object);
        }
    };

    return visit(value, 0);
}
