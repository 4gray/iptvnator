/* eslint-disable max-lines -- Keep the security-sensitive HAR reduction and redaction boundary auditable in one module. */
import { TextDecoder } from 'node:util';
import {
    REPLAY_HTTP_METHODS,
    REPLAY_MAX_ORIGINS,
    REPLAY_MAX_PHASES,
    type ReplayFieldMatchers,
    type ReplayFixtureV1,
    type ReplayGenerateNode,
    type ReplayHttpMethod,
    type ReplayOriginUrlNode,
    type ReplayPartsNode,
    type ReplayRefNode,
    type ReplayRequestBodyMatcher,
    type ReplayRequestMatcher,
    type ReplayResponseBody,
    type ReplayResponseDefinition,
    type ReplayResponseHeaderValue,
    type ReplaySymbolValueKind,
    type ReplayTemplateString,
    type ReplayTemplateValue,
} from '@iptvnator/portal/stalker/replay-fixtures';
import {
    HAR_READER_ERROR_CODES,
    HAR_READER_LIMITS,
    HarReaderError,
    decodeHarBase64,
} from './har-reader';
import {
    FixtureValidationError,
    type ValidatedReplayFixture,
    validateReplayFixtureText,
} from './fixture-validator';

export const HAR_TO_DRAFT_ERROR_CODES = {
    InvalidHarStructure: 'invalid-har-structure',
    TooManyEntries: 'too-many-entries',
    TooManyOrigins: 'too-many-origins',
    UnsupportedMethod: 'unsupported-method',
    UnknownExternalOrigin: 'unknown-external-origin',
    InvalidContentBody: 'invalid-content-body',
    AggregateBodyTooLarge: 'aggregate-body-too-large',
    DraftValidationFailed: 'draft-validation-failed',
    UnsupportedCommand: 'unsupported-command',
    InternalError: 'internal-error',
} as const;

export type HarToDraftErrorCode =
    (typeof HAR_TO_DRAFT_ERROR_CODES)[keyof typeof HAR_TO_DRAFT_ERROR_CODES];

export class HarToDraftError extends Error {
    constructor(readonly code: HarToDraftErrorCode) {
        super(`Stalker HAR conversion failed: ${code}.`);
        this.name = 'HarToDraftError';
    }
}

interface ParsedEntry {
    request: Record<string, unknown>;
    response: Record<string, unknown>;
}

interface ParsedRequestTarget {
    method: ReplayHttpMethod;
    origin: string;
    path: string;
    url: URL;
}

interface ConversionBudget {
    decodedBodyBytes: number;
}

const MAX_HAR_ENTRIES = REPLAY_MAX_PHASES;
const MAX_HAR_FIELDS = 256;
const MAX_CAPTURED_SYMBOLS = 512;
const MAX_CAPTURED_NAME_BYTES = 256;
const MIN_EMBEDDED_SYMBOL_LENGTH = 4;
const MAX_SAFE_LITERAL_BYTES = 64 * 1024;
const SAFE_HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;
const SAFE_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HTTP_SCHEME = /^https?:$/;
const ABSOLUTE_URL = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'\\]+/g;
const MAC_VALUE = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i;
const JWT_VALUE =
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/;
const AUTH_VALUE = /\b(?:basic|bearer)\s+[A-Za-z0-9+/_=.-]{8,}/i;
const HIGH_ENTROPY_VALUE = /[A-Za-z0-9+/_=-]{32,}/;
const SENSITIVE_ASSIGNMENT =
    /(?:^|[?&;\s"'{}:,])(?:authorization|cookie|set[-_]?cookie|credential|login|mac|password|passwd|prehash|serial|signature\d*|sn|token|username|account_?id|device_?id\d*)["']?\s*(?:=|:)\s*[^\s&;,}]+/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/i;
const MAC_KEY = /^mac$/i;
const CREDENTIAL_KEY =
    /^(?:credential|login|password|passwd|prehash|username)$/i;
const TOKEN_KEY = /^(?:authorization|token)$/i;
const RANDOM_KEY =
    /^(?:serial|sn|signature\d*|account_?id|device_?id\d*|artwork|artwork_url|image|image_url|logo|logo_url|poster|poster_url|provider|provider_url|stream|stream_url|thumbnail|thumbnail_url)$/i;
const TEXTUAL_MIME =
    /^(?:application\/(?:javascript|x-javascript|xml)|text\/)/i;
const JSONP_MIME = /(?:java|ecma)script|jsonp/i;
const JSONP_BODY =
    /^\s*([A-Za-z_$][A-Za-z0-9_$]{0,63})\s*\(([\s\S]*)\)\s*;?\s*$/;
const JSON_MIME = /(?:^|[/+])json(?:$|;)/i;
const FORM_MIME = /^application\/x-www-form-urlencoded(?:$|;)/i;
const RELEVANT_REQUEST_HEADERS = new Set([
    'accept',
    'accept-language',
    'authorization',
    'content-type',
    'sn',
    'user-agent',
    'x-user-agent',
]);

export function convertHarToReplayDraft(
    input: unknown
): ValidatedReplayFixture {
    const entries = parseEntries(input);
    const origins = new OriginRegistry();
    const initialTargets = entries.map((entry) =>
        parseRequestTarget(entry.request, origins)
    );
    const symbols = new SymbolRegistry();
    buildPhases(entries, initialTargets, origins, symbols, {
        decodedBodyBytes: 0,
    });
    const targets = entries.map((entry) =>
        parseRequestTarget(entry.request, origins, symbols)
    );
    const phases = buildPhases(entries, targets, origins, symbols, {
        decodedBodyBytes: 0,
    });

    const firstTarget = targets[0];
    const finalTarget = targets.at(-1);
    if (firstTarget === undefined || finalTarget === undefined) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }

    const fixture: ReplayFixtureV1 = {
        schemaVersion: 1,
        scenarioId: 'har-replay-draft',
        description: 'Sanitized HAR replay draft.',
        origins: origins.definitions(),
        entry: {
            origin: origins.nameForKnown(firstTarget.origin),
            path: firstTarget.path,
        },
        expectedEndpoint: {
            origin: origins.nameForKnown(finalTarget.origin),
            path: finalTarget.path,
        },
        initialState: stateName(0),
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: symbols.declarations(),
        phases,
    };

    try {
        return validateReplayFixtureText(JSON.stringify(fixture));
    } catch (error) {
        if (error instanceof FixtureValidationError) {
            reject(HAR_TO_DRAFT_ERROR_CODES.DraftValidationFailed);
        }
        throw error;
    }
}

function buildPhases(
    entries: readonly ParsedEntry[],
    targets: readonly ParsedRequestTarget[],
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    budget: ConversionBudget
): ReplayFixtureV1['phases'] {
    return entries.map((entry, index) => {
        const target = targets[index];
        if (target === undefined) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        const state = stateName(index);
        const nextState =
            index === entries.length - 1 ? 'complete' : stateName(index + 1);
        return {
            name: `phase-${sequence(index)}`,
            state,
            nextState,
            mode: 'ordered' as const,
            expectations: [
                {
                    id: `request-${sequence(index)}`,
                    operation: `captured-request-${sequence(index)}`,
                    origin: origins.nameForKnown(target.origin),
                    method: target.method,
                    path: target.path,
                    request: convertRequest(
                        entry.request,
                        target.url,
                        origins,
                        symbols,
                        budget
                    ),
                    response: convertResponse(
                        entry.response,
                        target.url,
                        origins,
                        symbols,
                        budget
                    ),
                    cardinality: { min: 1, max: 1 },
                },
            ],
        };
    });
}

class OriginRegistry {
    private readonly names = new Map<string, string>();

    register(origin: string): string {
        const existing = this.names.get(origin);
        if (existing !== undefined) {
            return existing;
        }
        if (this.names.size >= REPLAY_MAX_ORIGINS) {
            reject(HAR_TO_DRAFT_ERROR_CODES.TooManyOrigins);
        }
        const name = `origin-${this.names.size + 1}`;
        this.names.set(origin, name);
        return name;
    }

    nameForKnown(origin: string): string {
        const name = this.names.get(origin);
        if (name === undefined) {
            reject(HAR_TO_DRAFT_ERROR_CODES.UnknownExternalOrigin);
        }
        return name;
    }

    definitions(): ReplayFixtureV1['origins'] {
        return Object.fromEntries(
            [...this.names.values()].map((name) => [name, {}])
        );
    }
}

class SymbolRegistry {
    private readonly byRawValue = new Map<
        string,
        { declaration: ReplayGenerateNode; rank: number }
    >();
    private readonly ordered: ReplayGenerateNode[] = [];
    private readonly counts = new Map<ReplaySymbolValueKind, number>();

    reference(
        rawValue: string,
        valueKind: ReplaySymbolValueKind
    ): ReplayRefNode {
        const rank = symbolKindRank(valueKind);
        const existing = this.byRawValue.get(rawValue);
        if (existing !== undefined) {
            if (rank > existing.rank) {
                existing.declaration.valueKind = valueKind;
                existing.rank = rank;
            }
            return {
                kind: 'ref',
                symbol: existing.declaration.symbol,
            };
        }

        const count = (this.counts.get(valueKind) ?? 0) + 1;
        this.counts.set(valueKind, count);
        const declaration: ReplayGenerateNode = {
            kind: 'generate',
            symbol: `${valueKind}-${count}`,
            valueKind,
        };
        if (this.ordered.length >= MAX_CAPTURED_SYMBOLS) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        this.byRawValue.set(rawValue, { declaration, rank });
        this.ordered.push(declaration);
        return { kind: 'ref', symbol: declaration.symbol };
    }

    declarations(): ReplayGenerateNode[] {
        return this.ordered.map((declaration) => ({ ...declaration }));
    }

    knownReference(rawValue: string): ReplayRefNode | undefined {
        const existing = this.byRawValue.get(rawValue);
        return existing === undefined
            ? undefined
            : {
                  kind: 'ref',
                  symbol: existing.declaration.symbol,
              };
    }

    knownTemplate(rawValue: string): ReplayTemplateString | undefined {
        const exact = this.knownReference(rawValue);
        if (exact !== undefined) {
            return exact;
        }

        const parts: ReplayPartsNode['parts'] = [];
        let cursor = 0;
        let matched = false;
        while (cursor < rawValue.length) {
            let selected:
                | {
                      declaration: ReplayGenerateNode;
                      index: number;
                      raw: string;
                  }
                | undefined;
            for (const [raw, { declaration }] of this.byRawValue) {
                if (raw.length < MIN_EMBEDDED_SYMBOL_LENGTH) {
                    continue;
                }
                const index = rawValue.indexOf(raw, cursor);
                if (
                    index >= 0 &&
                    (selected === undefined ||
                        index < selected.index ||
                        (index === selected.index &&
                            raw.length > selected.raw.length))
                ) {
                    selected = { declaration, index, raw };
                }
            }
            if (selected === undefined) {
                break;
            }
            if (selected.index > cursor) {
                parts.push({
                    kind: 'literal',
                    value: rawValue.slice(cursor, selected.index),
                });
            }
            parts.push({
                kind: 'ref',
                symbol: selected.declaration.symbol,
            });
            matched = true;
            cursor = selected.index + selected.raw.length;
            if (parts.length >= 63) {
                return this.reference(rawValue, 'random');
            }
        }
        if (!matched) {
            return undefined;
        }
        if (cursor < rawValue.length) {
            parts.push({
                kind: 'literal',
                value: rawValue.slice(cursor),
            });
        }
        return { kind: 'parts', parts };
    }
}

function parseEntries(input: unknown): ParsedEntry[] {
    const root = requireRecord(input);
    const log = requireRecord(root['log']);
    const rawEntries = log['entries'];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    if (rawEntries.length > MAX_HAR_ENTRIES) {
        reject(HAR_TO_DRAFT_ERROR_CODES.TooManyEntries);
    }
    return rawEntries.map((rawEntry) => {
        const entry = requireRecord(rawEntry);
        return {
            request: requireRecord(entry['request']),
            response: requireRecord(entry['response']),
        };
    });
}

function parseRequestTarget(
    request: Record<string, unknown>,
    origins: OriginRegistry,
    symbols?: SymbolRegistry
): ParsedRequestTarget {
    const rawMethod = requireString(request['method']);
    if (
        !REPLAY_HTTP_METHODS.includes(
            rawMethod as (typeof REPLAY_HTTP_METHODS)[number]
        )
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.UnsupportedMethod);
    }
    const url = parseHttpUrl(requireString(request['url']));
    origins.register(url.origin);
    return {
        method: rawMethod as ReplayHttpMethod,
        origin: url.origin,
        path: sanitizePath(url.pathname, symbols),
        url,
    };
}

function convertRequest(
    request: Record<string, unknown>,
    url: URL,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    budget: ConversionBudget
): ReplayRequestMatcher {
    const capturedHeaders = parseNameValueList(request['headers'], 'header');
    return {
        query: convertQuery(url.searchParams, origins, symbols),
        headers: convertRequestHeaders(capturedHeaders, origins, symbols),
        cookies: {
            exact: convertRequestCookies(
                request['cookies'],
                capturedHeaders,
                origins,
                symbols
            ),
            present: [],
            absent: [],
            attributes: {},
        },
        body: convertRequestBody(
            request['postData'],
            capturedHeaders,
            origins,
            symbols,
            budget
        ),
    };
}

function convertQuery(
    searchParams: URLSearchParams,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayRequestMatcher['query'] {
    const grouped = new Map<string, string[]>();
    for (const [rawName, value] of searchParams) {
        const name = normalizeCapturedName(rawName, symbols);
        const values = grouped.get(name) ?? [];
        values.push(value);
        if (values.length > MAX_HAR_FIELDS) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        grouped.set(name, values);
    }
    if (grouped.size > MAX_HAR_FIELDS) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }

    const exact: ReplayRequestMatcher['query']['exact'] = {};
    for (const [name, values] of grouped) {
        const sanitized = values.map((value) =>
            sanitizeTemplateString(value, name, origins, symbols)
        );
        exact[name] = collapseValues(sanitized);
    }
    return { exact, present: [], absent: [] };
}

function convertRequestHeaders(
    headers: Map<string, string[]>,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayRequestMatcher['headers'] {
    const exact: ReplayRequestMatcher['headers']['exact'] = {};
    for (const [name, values] of headers) {
        if (!RELEVANT_REQUEST_HEADERS.has(name)) {
            continue;
        }
        const sanitized = values.map((value) => {
            if (name === 'authorization') {
                return sanitizeAuthorization(value, symbols);
            }
            if (name === 'content-type') {
                return sanitizeContentType(value);
            }
            return sanitizeTemplateString(value, name, origins, symbols);
        });
        exact[name] = collapseValues(sanitized);
    }
    return { exact, present: [], absent: [] };
}

function convertRequestCookies(
    rawCookies: unknown,
    headers: Map<string, string[]>,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayRequestMatcher['cookies']['exact'] {
    const cookies = new Map<string, string>();
    const cookieHeaders = headers.get('cookie') ?? [];
    for (const header of cookieHeaders) {
        for (const [name, value] of parseCookieHeader(header)) {
            setConsistentValue(cookies, name, value);
        }
    }
    if (rawCookies !== undefined) {
        for (const cookie of parseNameValueArray(rawCookies, 'cookie')) {
            setConsistentValue(cookies, cookie.name, cookie.value);
        }
    }
    const exact: ReplayRequestMatcher['cookies']['exact'] = {};
    for (const [name, value] of cookies) {
        assertNoKnownSymbolLiteral(name, symbols);
        exact[name] = sanitizeTemplateString(
            value,
            name,
            origins,
            symbols,
            cookieValueKind(name, value)
        );
    }
    return exact;
}

function convertRequestBody(
    rawPostData: unknown,
    headers: Map<string, string[]>,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    budget: ConversionBudget
): ReplayRequestBodyMatcher {
    if (rawPostData === undefined) {
        return { kind: 'absent' };
    }
    const postData = requireRecord(rawPostData);
    const mimeType =
        optionalString(postData['mimeType']) ??
        headers.get('content-type')?.[0] ??
        '';

    if (Array.isArray(postData['params'])) {
        return {
            kind: 'form',
            ...convertFormPairs(
                parseNameValueArray(postData['params'], 'form'),
                origins,
                symbols
            ),
        };
    }

    const text = optionalBodyString(postData['text']);
    if (text === undefined || text.length === 0) {
        return { kind: 'absent' };
    }
    const bodyBytes = decodeCapturedBody(
        text,
        optionalString(postData['encoding']),
        budget
    );
    const bodyText = decodeBodyUtf8(bodyBytes);

    if (JSON_MIME.test(mimeType)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(bodyText) as unknown;
        } catch {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
        }
        if (!isRecord(parsed)) {
            return {
                kind: 'text',
                exact: symbols.reference(bodyText, 'random'),
            };
        }
        const exact: Record<string, ReplayTemplateValue> = {};
        for (const [name, value] of boundedEntries(parsed)) {
            exact[normalizeCapturedName(name, symbols)] = sanitizeJsonValue(
                value,
                name,
                origins,
                symbols
            );
        }
        return { kind: 'json', exact, present: [], absent: [] };
    }

    if (FORM_MIME.test(mimeType)) {
        const pairs = [...new URLSearchParams(bodyText)].map(
            ([name, value]) => ({
                name: normalizeCapturedName(name, symbols),
                value,
            })
        );
        return {
            kind: 'form',
            ...convertFormPairs(pairs, origins, symbols),
        };
    }

    return {
        kind: 'text',
        exact: sanitizeOpaqueText(bodyText, origins, symbols),
    };
}

function convertFormPairs(
    pairs: readonly { name: string; value: string }[],
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayFieldMatchers<ReplayTemplateString> {
    if (pairs.length > MAX_HAR_FIELDS) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    const exact: Record<string, ReplayTemplateString> = {};
    for (const pair of pairs) {
        const name = normalizeCapturedName(pair.name, symbols);
        if (Object.prototype.hasOwnProperty.call(exact, name)) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        exact[name] = sanitizeTemplateString(
            pair.value,
            name,
            origins,
            symbols
        );
    }
    return { exact, present: [], absent: [] };
}

function convertResponse(
    response: Record<string, unknown>,
    requestUrl: URL,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    budget: ConversionBudget
): ReplayResponseDefinition {
    const status = response['status'];
    if (
        typeof status !== 'number' ||
        !Number.isInteger(status) ||
        status < 100 ||
        status > 599
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    const capturedHeaders = parseNameValueList(response['headers'], 'header');
    return {
        status,
        headers: convertResponseHeaders(
            capturedHeaders,
            response['cookies'],
            requestUrl,
            origins,
            symbols
        ),
        body: convertResponseBody(
            response['content'],
            capturedHeaders,
            origins,
            symbols,
            budget
        ),
    };
}

function convertResponseHeaders(
    captured: Map<string, string[]>,
    rawCookies: unknown,
    requestUrl: URL,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayResponseDefinition['headers'] {
    const output: Record<string, ReplayResponseHeaderValue[]> = {};
    const contentTypes = captured.get('content-type');
    if (contentTypes !== undefined) {
        output['content-type'] = contentTypes.map(sanitizeContentType);
    }
    const locations = captured.get('location');
    if (locations !== undefined) {
        output['location'] = locations.map((value) =>
            convertLocation(value, requestUrl, origins, symbols)
        );
    }

    const setCookies = captured
        .get('set-cookie')
        ?.map((value) => convertSetCookie(value, origins, symbols));
    if (setCookies !== undefined && setCookies.length > 0) {
        output['set-cookie'] = setCookies;
    } else if (rawCookies !== undefined) {
        const cookieValues = parseResponseCookies(rawCookies, origins, symbols);
        if (cookieValues.length > 0) {
            output['set-cookie'] = cookieValues;
        }
    }
    return output;
}

function convertLocation(
    value: string,
    requestUrl: URL,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayOriginUrlNode {
    const url = parseHttpUrl(value, requestUrl);
    const query: NonNullable<ReplayOriginUrlNode['query']> = {};
    const grouped = new Map<string, ReplayTemplateString[]>();
    for (const [rawName, rawValue] of url.searchParams) {
        const name = normalizeCapturedName(rawName, symbols);
        const values = grouped.get(name) ?? [];
        values.push(sanitizeTemplateString(rawValue, name, origins, symbols));
        grouped.set(name, values);
    }
    for (const [name, values] of grouped) {
        query[name] = collapseValues(values);
    }

    const node: ReplayOriginUrlNode = {
        kind: 'origin-url',
        origin: origins.nameForKnown(url.origin),
        path: sanitizePath(url.pathname, symbols),
    };
    if (url.username.length > 0) {
        node.userInfo = {
            username: symbols.reference(
                decodeUrlComponent(url.username),
                'credential'
            ),
        };
        if (url.password.length > 0) {
            node.userInfo.password = symbols.reference(
                decodeUrlComponent(url.password),
                'credential'
            );
        }
    }
    if (Object.keys(query).length > 0) {
        node.query = query;
    }
    return node;
}

function convertSetCookie(
    value: string,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayPartsNode {
    const segments = value.split(';');
    const pair = segments.shift();
    if (pair === undefined) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    const separator = pair.indexOf('=');
    if (separator <= 0) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    const name = normalizeCookieName(pair.slice(0, separator).trim());
    assertNoKnownSymbolLiteral(name, symbols);
    const rawValue = pair.slice(separator + 1).trim();
    const suffix = sanitizeSetCookieAttributes(segments, symbols);
    const reference = sanitizeTemplateString(
        rawValue,
        name,
        origins,
        symbols,
        cookieValueKind(name, rawValue)
    );
    if (!isRefNode(reference)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    const parts: ReplayPartsNode['parts'] = [
        { kind: 'literal', value: `${name}=` },
        reference,
    ];
    if (suffix.length > 0) {
        parts.push({ kind: 'literal', value: suffix });
    }
    return { kind: 'parts', parts };
}

function parseResponseCookies(
    rawCookies: unknown,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayPartsNode[] {
    if (!Array.isArray(rawCookies)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    if (rawCookies.length > MAX_HAR_FIELDS) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return rawCookies.map((rawCookie) => {
        const cookie = requireRecord(rawCookie);
        const name = normalizeCookieName(requireString(cookie['name']));
        assertNoKnownSymbolLiteral(name, symbols);
        const value = requireString(cookie['value']);
        const suffixParts: string[] = [];
        const path = optionalString(cookie['path']);
        if (path !== undefined && isSafeCookiePath(path)) {
            suffixParts.push(`Path=${sanitizePath(path, symbols)}`);
        }
        if (cookie['httpOnly'] === true) {
            suffixParts.push('HttpOnly');
        }
        if (cookie['secure'] === true) {
            suffixParts.push('Secure');
        }
        const sameSite = optionalString(cookie['sameSite'])?.toLowerCase();
        if (
            sameSite !== undefined &&
            ['strict', 'lax', 'none'].includes(sameSite)
        ) {
            suffixParts.push(
                `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`
            );
        }
        return convertSetCookie(
            `${name}=${value}${
                suffixParts.length > 0 ? `; ${suffixParts.join('; ')}` : ''
            }`,
            origins,
            symbols
        );
    });
}

function sanitizeSetCookieAttributes(
    segments: readonly string[],
    symbols: SymbolRegistry
): string {
    const safe: string[] = [];
    for (const rawSegment of segments) {
        const segment = rawSegment.trim();
        if (/^secure$/i.test(segment)) {
            safe.push('Secure');
        } else if (/^httponly$/i.test(segment)) {
            safe.push('HttpOnly');
        } else {
            const separator = segment.indexOf('=');
            if (separator <= 0) {
                continue;
            }
            const name = segment.slice(0, separator).trim().toLowerCase();
            const value = segment.slice(separator + 1).trim();
            if (name === 'path' && isSafeCookiePath(value)) {
                safe.push(`Path=${sanitizePath(value, symbols)}`);
            } else if (
                name === 'samesite' &&
                /^(?:strict|lax|none)$/i.test(value)
            ) {
                safe.push(
                    `SameSite=${value.charAt(0).toUpperCase()}${value
                        .slice(1)
                        .toLowerCase()}`
                );
            }
        }
    }
    return safe.length === 0 ? '' : `; ${safe.join('; ')}`;
}

function convertResponseBody(
    rawContent: unknown,
    headers: Map<string, string[]>,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    budget: ConversionBudget
): ReplayResponseBody {
    if (rawContent === undefined) {
        return { kind: 'empty' };
    }
    const content = requireRecord(rawContent);
    const text = optionalBodyString(content['text']);
    if (text === undefined || text.length === 0) {
        return { kind: 'empty' };
    }
    const bytes = decodeCapturedBody(
        text,
        optionalString(content['encoding']),
        budget
    );
    const mimeType =
        optionalString(content['mimeType']) ??
        headers.get('content-type')?.[0] ??
        '';

    if (JSON_MIME.test(mimeType)) {
        const decoded = decodeBodyUtf8(bytes);
        let value: unknown;
        try {
            value = JSON.parse(decoded) as unknown;
        } catch {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
        }
        return {
            kind: 'json',
            value: sanitizeJsonValue(value, '', origins, symbols),
        };
    }

    if (TEXTUAL_MIME.test(mimeType)) {
        const decoded = decodeBodyUtf8(bytes);
        const jsonp = JSONP_MIME.test(mimeType)
            ? parseJsonpBody(decoded, origins, symbols)
            : undefined;
        if (jsonp !== undefined) {
            return jsonp;
        }
        assertKnownOriginsInText(decoded, origins);
        return {
            kind: 'text',
            value: 'sanitized-text-body',
        };
    }

    return {
        kind: 'generated',
        byteLength: bytes.byteLength,
        byte: 0,
    };
}

function sanitizeJsonValue(
    value: unknown,
    parentKey: string,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    depth = 0
): ReplayTemplateValue {
    if (depth > HAR_READER_LIMITS.MaxJsonDepth) {
        throw new HarReaderError(HAR_READER_ERROR_CODES.HarTooDeep);
    }
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
        }
        return isTimestampNumber(value) ? 0 : value;
    }
    if (typeof value === 'string') {
        if (ISO_TIMESTAMP.test(value)) {
            return '1970-01-01T00:00:00.000Z';
        }
        return sanitizeTemplateString(value, parentKey, origins, symbols);
    }
    if (Array.isArray(value)) {
        if (value.length > HAR_READER_LIMITS.MaxCollectionItems) {
            throw new HarReaderError(
                HAR_READER_ERROR_CODES.HarCollectionTooLarge
            );
        }
        return value.map((item) =>
            sanitizeJsonValue(item, parentKey, origins, symbols, depth + 1)
        );
    }
    if (!isRecord(value)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
    }
    const output: Record<string, ReplayTemplateValue> = {};
    for (const [key, child] of boundedEntries(value)) {
        const safeKey = normalizeCapturedName(key, symbols);
        output[safeKey] = sanitizeJsonValue(
            child,
            safeKey,
            origins,
            symbols,
            depth + 1
        );
    }
    return output;
}

function sanitizeTemplateString(
    rawValue: string,
    key: string,
    origins: OriginRegistry,
    symbols: SymbolRegistry,
    forcedKind?: ReplaySymbolValueKind
): ReplayTemplateString {
    assertBoundedLiteral(rawValue);
    const variants = decodedVariants(rawValue);
    let containsUrl = false;
    for (const variant of variants) {
        containsUrl = assertKnownOriginsInText(variant, origins) || containsUrl;
    }
    const valueKind =
        forcedKind ??
        symbolKindForKey(key) ??
        symbolKindForVariants(variants) ??
        (containsUrl ? 'random' : undefined);
    return valueKind === undefined
        ? (symbols.knownTemplate(rawValue) ?? rawValue)
        : symbols.reference(rawValue, valueKind);
}

function sanitizeAuthorization(
    rawValue: string,
    symbols: SymbolRegistry
): ReplayTemplateString {
    assertBoundedLiteral(rawValue);
    const match = /^\s*(Basic|Bearer)\s+(.+?)\s*$/i.exec(rawValue);
    if (match === null) {
        return symbols.reference(rawValue, 'token');
    }
    const scheme = match[1];
    const credential = match[2];
    if (scheme === undefined || credential === undefined) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return {
        kind: 'parts',
        parts: [
            {
                kind: 'literal',
                value: `${scheme.charAt(0).toUpperCase()}${scheme
                    .slice(1)
                    .toLowerCase()} `,
            },
            symbols.reference(credential, 'token'),
        ],
    };
}

function sanitizeOpaqueText(
    rawValue: string,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): ReplayTemplateString {
    assertBoundedLiteral(rawValue);
    assertKnownOriginsInText(rawValue, origins);
    return symbols.reference(rawValue, 'random');
}

function decodeCapturedBody(
    text: string,
    encoding: string | undefined,
    budget: ConversionBudget
): Buffer {
    let bytes: Buffer;
    if (encoding === undefined) {
        bytes = Buffer.from(text);
        if (bytes.byteLength > HAR_READER_LIMITS.MaxDecodedBodyBytes) {
            throw new HarReaderError(
                HAR_READER_ERROR_CODES.DecodedBodyTooLarge
            );
        }
    } else if (encoding === 'base64') {
        bytes = decodeHarBase64(text);
    } else {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
    }
    budget.decodedBodyBytes += bytes.byteLength;
    if (
        budget.decodedBodyBytes > HAR_READER_LIMITS.MaxAggregateDecodedBodyBytes
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.AggregateBodyTooLarge);
    }
    return bytes;
}

function decodeBodyUtf8(bytes: Buffer): string {
    try {
        return new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
        }).decode(bytes);
    } catch {
        throw new HarReaderError(HAR_READER_ERROR_CODES.InvalidUtf8);
    }
}

function parseNameValueList(
    input: unknown,
    kind: 'header'
): Map<string, string[]> {
    if (input === undefined) {
        return new Map();
    }
    const pairs = parseNameValueArray(input, kind);
    const output = new Map<string, string[]>();
    for (const pair of pairs) {
        const name = pair.name.toLowerCase();
        if (!SAFE_HEADER_NAME.test(name)) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        const values = output.get(name) ?? [];
        values.push(pair.value);
        if (values.length > MAX_HAR_FIELDS) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        output.set(name, values);
    }
    return output;
}

function parseNameValueArray(
    input: unknown,
    kind: 'cookie' | 'form' | 'header'
): Array<{ name: string; value: string }> {
    if (!Array.isArray(input) || input.length > MAX_HAR_FIELDS) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return input.map((rawPair) => {
        const pair = requireRecord(rawPair);
        const rawName = requireString(pair['name']);
        const name =
            kind === 'cookie'
                ? normalizeCookieName(rawName)
                : normalizeCapturedName(rawName);
        return {
            name,
            value: requireString(pair['value']),
        };
    });
}

function parseCookieHeader(value: string): Array<[string, string]> {
    assertBoundedLiteral(value);
    const output: Array<[string, string]> = [];
    for (const segment of value.split(';')) {
        const separator = segment.indexOf('=');
        if (separator <= 0) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        output.push([
            normalizeCookieName(segment.slice(0, separator).trim()),
            segment.slice(separator + 1).trim(),
        ]);
        if (output.length > MAX_HAR_FIELDS) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
    }
    return output;
}

function setConsistentValue(
    values: Map<string, string>,
    name: string,
    value: string
): void {
    const existing = values.get(name);
    if (existing !== undefined && existing !== value) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    values.set(name, value);
}

function parseHttpUrl(value: string, base?: URL): URL {
    assertBoundedLiteral(value);
    let url: URL;
    try {
        url = base === undefined ? new URL(value) : new URL(value, base);
    } catch {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    if (!HTTP_SCHEME.test(url.protocol)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return url;
}

function parseJsonpBody(
    value: string,
    origins: OriginRegistry,
    symbols: SymbolRegistry
): Extract<ReplayResponseBody, { kind: 'jsonp' }> | undefined {
    const match = JSONP_BODY.exec(value);
    if (match === null) {
        return undefined;
    }
    const callback = match[1];
    const json = match[2];
    if (
        callback === undefined ||
        json === undefined ||
        ['__proto__', 'constructor', 'prototype'].includes(callback)
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
    }
    assertNoKnownSymbolLiteral(callback, symbols);
    let parsed: unknown;
    try {
        parsed = JSON.parse(json) as unknown;
    } catch {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidContentBody);
    }
    return {
        kind: 'jsonp',
        callback,
        value: sanitizeJsonValue(parsed, '', origins, symbols),
    };
}

function assertKnownOriginsInText(
    value: string,
    origins: OriginRegistry
): boolean {
    ABSOLUTE_URL.lastIndex = 0;
    let found = false;
    for (const match of value.matchAll(ABSOLUTE_URL)) {
        found = true;
        const rawUrl = trimUrlPunctuation(match[0]);
        const url = parseHttpUrl(rawUrl);
        origins.nameForKnown(url.origin);
    }
    return found;
}

function sanitizePath(path: string, symbols?: SymbolRegistry): string {
    if (
        path.length === 0 ||
        path.length > 2048 ||
        !path.startsWith('/') ||
        path.includes('\\') ||
        path.includes('?') ||
        path.includes('#')
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return path
        .split('/')
        .map((segment, index) => {
            if (index === 0 || segment.length === 0) {
                return segment;
            }
            const decoded = decodeUrlComponent(segment);
            return symbolKindForVariants(decodedVariants(decoded)) ===
                undefined && symbols?.knownTemplate(decoded) === undefined
                ? segment
                : 'redacted';
        })
        .join('/');
}

function sanitizeContentType(value: string): ReplayTemplateString {
    assertBoundedLiteral(value);
    const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
    if (
        mediaType === undefined ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    if (HIGH_ENTROPY_VALUE.test(mediaType)) {
        const chunks = mediaType.match(/.{1,24}/g);
        if (chunks === null) {
            reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
        }
        return {
            kind: 'parts',
            parts: chunks.map((part) => ({
                kind: 'literal' as const,
                value: part,
            })),
        };
    }
    return mediaType;
}

function normalizeCookieName(value: string): string {
    assertBoundedLiteral(value);
    if (!SAFE_COOKIE_NAME.test(value)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return value;
}

function normalizeCapturedName(
    value: string,
    symbols?: SymbolRegistry
): string {
    assertBoundedLiteral(value);
    if (
        value.length === 0 ||
        Buffer.byteLength(value) > MAX_CAPTURED_NAME_BYTES ||
        hasControlOrBackslash(value) ||
        value.includes('${') ||
        value.includes('{{') ||
        value.includes('<%')
    ) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    assertNoSensitiveNameLiteral(value);
    if (symbols !== undefined) {
        assertNoKnownSymbolLiteral(value, symbols);
    }
    return value;
}

function assertNoKnownSymbolLiteral(
    value: string,
    symbols: SymbolRegistry
): void {
    if (symbols.knownTemplate(value) !== undefined) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
}

function assertNoSensitiveNameLiteral(value: string): void {
    if (
        MAC_VALUE.test(value) ||
        JWT_VALUE.test(value) ||
        HIGH_ENTROPY_VALUE.test(value) ||
        ABSOLUTE_URL.test(value)
    ) {
        ABSOLUTE_URL.lastIndex = 0;
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    ABSOLUTE_URL.lastIndex = 0;
}

function assertBoundedLiteral(value: string): void {
    if (Buffer.byteLength(value) > MAX_SAFE_LITERAL_BYTES) {
        throw new HarReaderError(HAR_READER_ERROR_CODES.HarStringTooLarge);
    }
}

function symbolKindForKey(key: string): ReplaySymbolValueKind | undefined {
    if (MAC_KEY.test(key)) {
        return 'mac';
    }
    if (CREDENTIAL_KEY.test(key)) {
        return 'credential';
    }
    if (TOKEN_KEY.test(key)) {
        return 'token';
    }
    if (RANDOM_KEY.test(key)) {
        return 'random';
    }
    return undefined;
}

function cookieValueKind(name: string, value: string): ReplaySymbolValueKind {
    return (
        symbolKindForKey(name) ??
        symbolKindForVariants(decodedVariants(value)) ??
        'cookie'
    );
}

function symbolKindForVariants(
    variants: readonly string[]
): ReplaySymbolValueKind | undefined {
    if (variants.some((variant) => MAC_VALUE.test(variant))) {
        return 'mac';
    }
    if (
        variants.some(
            (variant) =>
                JWT_VALUE.test(variant) ||
                AUTH_VALUE.test(variant) ||
                HIGH_ENTROPY_VALUE.test(variant)
        )
    ) {
        return 'token';
    }
    if (variants.some((variant) => SENSITIVE_ASSIGNMENT.test(variant))) {
        return 'random';
    }
    return undefined;
}

function decodedVariants(value: string): readonly string[] {
    const variants = new Set([value]);
    let candidate = value;
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
            candidate = decoded;
        } catch {
            break;
        }
    }
    return [...variants];
}

function symbolKindRank(kind: ReplaySymbolValueKind): number {
    switch (kind) {
        case 'mac':
            return 6;
        case 'credential':
            return 5;
        case 'token':
            return 4;
        case 'cookie':
            return 3;
        case 'correlation':
            return 2;
        case 'random':
            return 1;
    }
}

function isTimestampNumber(value: number): boolean {
    return (
        (Number.isInteger(value) &&
            value >= 946_684_800 &&
            value <= 4_102_444_800) ||
        (Number.isInteger(value) &&
            value >= 946_684_800_000 &&
            value <= 4_102_444_800_000)
    );
}

function isSafeCookiePath(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= 2048 &&
        value.startsWith('/') &&
        !value.includes(';') &&
        !hasControlOrBackslash(value)
    );
}

function hasControlOrBackslash(value: string): boolean {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return character === '\\' || code <= 31 || code === 127;
    });
}

function collapseValues<T>(values: readonly T[]): T | T[] {
    const first = values[0];
    if (first === undefined) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return values.length === 1 ? first : [...values];
}

function isRefNode(value: ReplayTemplateString): value is ReplayRefNode {
    return typeof value === 'object' && value.kind === 'ref';
}

function decodeUrlComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
}

function trimUrlPunctuation(value: string): string {
    return value.replace(/[),.;\]}]+$/g, '');
}

function boundedEntries(
    value: Record<string, unknown>
): Array<[string, unknown]> {
    const entries = Object.entries(value);
    if (entries.length > HAR_READER_LIMITS.MaxCollectionItems) {
        throw new HarReaderError(HAR_READER_ERROR_CODES.HarCollectionTooLarge);
    }
    return entries;
}

function requireRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireString(value: unknown): string {
    if (typeof value !== 'string') {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    assertBoundedLiteral(value);
    return value;
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return requireString(value);
}

function optionalBodyString(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        reject(HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure);
    }
    if (Buffer.byteLength(value) > HAR_READER_LIMITS.MaxStringBytes) {
        throw new HarReaderError(HAR_READER_ERROR_CODES.HarStringTooLarge);
    }
    return value;
}

function stateName(index: number): string {
    return `state-${sequence(index)}`;
}

function sequence(index: number): string {
    return String(index + 1).padStart(3, '0');
}

function reject(code: HarToDraftErrorCode): never {
    throw new HarToDraftError(code);
}
