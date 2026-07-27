import type { ReplayFixtureV1 } from '@iptvnator/portal/stalker/replay-fixtures';

export const FIXTURE_SECRET_SCAN_ERROR_CODES = {
    SensitiveLiteral: 'sensitive-literal',
    JwtLiteral: 'jwt-literal',
    MacLiteral: 'mac-literal',
    ExternalUrl: 'external-url',
    HighEntropyLiteral: 'high-entropy-literal',
    NondeterministicTimestamp: 'nondeterministic-timestamp',
} as const;

export type FixtureSecretScanErrorCode =
    (typeof FIXTURE_SECRET_SCAN_ERROR_CODES)[keyof typeof FIXTURE_SECRET_SCAN_ERROR_CODES];

export class FixtureSecretScanError extends Error {
    constructor(readonly code: FixtureSecretScanErrorCode) {
        super(`Stalker fixture rejected: ${code}.`);
        this.name = 'FixtureSecretScanError';
    }
}

const SENSITIVE_KEY =
    /^(?:authorization|cookie|set[-_]?cookie|credential|login|mac|password|passwd|prehash|random|serial|signature\d*|sn|token|username|account_?id|device_?id\d*)$/i;
const SENSITIVE_URL_KEY =
    /^(?:artwork|artwork_url|image|image_url|logo|logo_url|poster|poster_url|provider|provider_url|stream|stream_url|thumbnail|thumbnail_url)$/i;
const SENSITIVE_PARTS_KEY =
    /^(?:authorization|cookie|set[-_]?cookie)$/i;
const SENSITIVE_ASSIGNMENT =
    /(?:^|[?&;\s"'{}:,])(?:authorization|cookie|set[-_]?cookie|credential|login|mac|password|passwd|prehash|random|serial|signature\d*|sn|token|username|account_?id|device_?id\d*)["']?\s*(?:=|:)\s*[^\s&;,}]+/i;
const AUTHORIZATION_VALUE = /\b(?:basic|bearer)\s+[A-Za-z0-9+/_=.-]{8,}/i;
const JWT_LITERAL =
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/;
const MAC_LITERAL = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i;
const ISO_TIMESTAMP =
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/i;
const URL_LITERAL =
    /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'\\]+/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;
const JSON_UNICODE_ESCAPE = /\\u([0-9A-F]{4})/gi;
const JSON_HEX_ESCAPE = /\\x([0-9A-F]{2})/gi;
const JSON_QUOTE_ESCAPE = /\\"/g;
const UNIX_SECONDS_MIN = 946_684_800;
const UNIX_SECONDS_MAX = 4_102_444_800;
const UNIX_MILLISECONDS_MIN = UNIX_SECONDS_MIN * 1000;
const UNIX_MILLISECONDS_MAX = UNIX_SECONDS_MAX * 1000;
const DETERMINISTIC_TIMESTAMP_NUMBERS = new Set([
    0,
    UNIX_SECONDS_MAX,
    UNIX_MILLISECONDS_MAX,
]);
const DETERMINISTIC_ISO_TIMESTAMPS = new Set([
    '1970-01-01T00:00:00.000Z',
    '2100-01-01T00:00:00.000Z',
]);

export function assertReplayFixtureContainsNoSecrets(
    fixture: ReplayFixtureV1
): void {
    inspectValue(fixture);
}

function inspectValue(value: unknown, parentKey?: string): void {
    if (typeof value === 'string') {
        if (
            parentKey !== undefined &&
            SENSITIVE_URL_KEY.test(parentKey) &&
            containsUrl(value)
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl);
        }
        inspectString(value);
        return;
    }

    if (typeof value === 'number') {
        if (isTimestampNumber(value)) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.NondeterministicTimestamp);
        }
        return;
    }

    if (value === null || typeof value !== 'object') {
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            inspectValue(item, parentKey);
        }
        return;
    }

    const record = value as Record<string, unknown>;
    if (isOpaqueTypedNode(record)) {
        inspectString(record['symbol'] as string);
        return;
    }
    if (record['kind'] === 'parts' && Array.isArray(record['parts'])) {
        if (
            parentKey !== undefined &&
            SENSITIVE_KEY.test(parentKey) &&
            (!SENSITIVE_PARTS_KEY.test(parentKey) ||
                !containsReference(record['parts']))
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral);
        }
        for (const part of record['parts']) {
            inspectValue(part);
        }
        return;
    }
    if (record['kind'] === 'literal' && typeof record['value'] === 'string') {
        inspectString(record['value']);
        return;
    }

    for (const [key, child] of Object.entries(record)) {
        inspectString(key);
        if (SENSITIVE_KEY.test(key) && !isProtectedValue(key, child)) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral);
        }
        if (
            SENSITIVE_URL_KEY.test(key) &&
            typeof child === 'string' &&
            containsUrl(child)
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl);
        }
        inspectValue(child, key);
    }
}

function isOpaqueTypedNode(value: Record<string, unknown>): boolean {
    return (
        (value['kind'] === 'generate' &&
            typeof value['symbol'] === 'string' &&
            typeof value['valueKind'] === 'string') ||
        (value['kind'] === 'ref' && typeof value['symbol'] === 'string')
    );
}

function isProtectedValue(key: string, value: unknown): boolean {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    if (Array.isArray(value)) {
        return (
            value.length > 0 &&
            value.every((item) => isProtectedValue(key, item))
        );
    }
    const record = value as Record<string, unknown>;
    if (isOpaqueTypedNode(record)) {
        return true;
    }
    return (
        SENSITIVE_PARTS_KEY.test(key) &&
        record['kind'] === 'parts' &&
        Array.isArray(record['parts']) &&
        containsReference(record['parts'])
    );
}

function containsReference(parts: readonly unknown[]): boolean {
    return parts.some((part) => {
        if (part === null || typeof part !== 'object' || Array.isArray(part)) {
            return false;
        }
        return (part as Record<string, unknown>)['kind'] === 'ref';
    });
}

function inspectString(value: string): void {
    for (const variant of decodedVariants(value)) {
        if (
            SENSITIVE_ASSIGNMENT.test(variant) ||
            AUTHORIZATION_VALUE.test(variant)
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral);
        }
        if (JWT_LITERAL.test(variant)) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.JwtLiteral);
        }
        if (MAC_LITERAL.test(variant)) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.MacLiteral);
        }
        inspectUrls(variant);
        if (
            (ISO_TIMESTAMP.test(variant) &&
                !DETERMINISTIC_ISO_TIMESTAMPS.has(variant)) ||
            (isIntegerString(variant) &&
                isTimestampNumber(Number.parseInt(variant, 10)))
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.NondeterministicTimestamp);
        }
        if (containsHighEntropyLiteral(variant)) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.HighEntropyLiteral);
        }
    }
}

function decodedVariants(value: string): readonly string[] {
    const variants = new Set<string>([value]);
    let candidate = decodeJsonEscapes(value);
    variants.add(candidate);

    for (let depth = 0; depth < 2; depth += 1) {
        if (!/%[0-9A-F]{2}/i.test(candidate)) {
            break;
        }
        try {
            const decoded = decodeURIComponent(candidate);
            variants.add(decoded);
            if (decoded === candidate) {
                break;
            }
            candidate = decodeJsonEscapes(decoded);
            variants.add(candidate);
        } catch {
            break;
        }
    }
    return [...variants];
}

function decodeJsonEscapes(value: string): string {
    return value
        .replace(JSON_UNICODE_ESCAPE, (_match, digits: string) =>
            String.fromCharCode(Number.parseInt(digits, 16))
        )
        .replace(JSON_HEX_ESCAPE, (_match, digits: string) =>
            String.fromCharCode(Number.parseInt(digits, 16))
        )
        .replace(JSON_QUOTE_ESCAPE, '"');
}

function inspectUrls(value: string): void {
    URL_LITERAL.lastIndex = 0;
    for (const match of value.matchAll(URL_LITERAL)) {
        const candidate = trimUrlPunctuation(match[0]);
        let parsed: URL;
        try {
            parsed = new URL(candidate);
        } catch {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl);
        }
        if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            !isReservedTestHost(parsed.hostname)
        ) {
            reject(FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl);
        }
        for (const key of parsed.searchParams.keys()) {
            if (SENSITIVE_KEY.test(key)) {
                reject(FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral);
            }
        }
    }
}

function containsUrl(value: string): boolean {
    URL_LITERAL.lastIndex = 0;
    return URL_LITERAL.test(value);
}

function trimUrlPunctuation(value: string): string {
    return value.replace(/[),.;\]}]+$/g, '');
}

function isReservedTestHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === 'example.com' ||
        normalized === 'example.net' ||
        normalized === 'example.org' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.test') ||
        normalized.endsWith('.invalid') ||
        normalized.endsWith('.example')
    );
}

function isIntegerString(value: string): boolean {
    return /^\d{10,13}$/.test(value);
}

function isTimestampNumber(value: number): boolean {
    if (DETERMINISTIC_TIMESTAMP_NUMBERS.has(value)) {
        return false;
    }
    return (
        (Number.isInteger(value) &&
            value >= UNIX_SECONDS_MIN &&
            value <= UNIX_SECONDS_MAX) ||
        (Number.isInteger(value) &&
            value >= UNIX_MILLISECONDS_MIN &&
            value <= UNIX_MILLISECONDS_MAX)
    );
}

function containsHighEntropyLiteral(value: string): boolean {
    for (const match of value.matchAll(HIGH_ENTROPY_TOKEN)) {
        const token = match[0].replace(/=+$/g, '');
        if (shannonEntropy(token) >= 4) {
            return true;
        }
    }
    return false;
}

function shannonEntropy(value: string): number {
    const counts = new Map<string, number>();
    for (const character of value) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
        const probability = count / value.length;
        entropy -= probability * Math.log2(probability);
    }
    return entropy;
}

function reject(code: FixtureSecretScanErrorCode): never {
    throw new FixtureSecretScanError(code);
}
