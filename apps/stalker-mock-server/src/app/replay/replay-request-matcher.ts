import { isDeepStrictEqual } from 'node:util';
import { ReplaySymbolTable } from './replay-symbols.js';
import {
    ReplayCookieAttributeMatchers,
    ReplayExpectation,
    ReplayFieldMatchers,
    ReplayObservedCookie,
    ReplayObservedRequest,
    ReplayTemplateString,
    ReplayTemplateValue,
} from './replay.types.js';

export type ReplayMismatchCode =
    | 'origin-mismatch'
    | 'method-mismatch'
    | 'path-mismatch'
    | 'query-presence-mismatch'
    | 'query-value-mismatch'
    | 'header-presence-mismatch'
    | 'header-value-mismatch'
    | 'cookie-presence-mismatch'
    | 'cookie-value-mismatch'
    | 'cookie-attribute-mismatch'
    | 'body-kind-mismatch'
    | 'body-presence-mismatch'
    | 'body-value-mismatch';

export type ReplayRequestMatchResult =
    | { matched: true }
    | { matched: false; code: ReplayMismatchCode };

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveExpected(
    value: ReplayTemplateString | ReplayTemplateString[],
    symbols: ReplaySymbolTable
): string[] {
    return (Array.isArray(value) ? value : [value]).map((item) =>
        symbols.resolveString(item)
    );
}

function matchStringFields(
    matcher: ReplayFieldMatchers<ReplayTemplateString | ReplayTemplateString[]>,
    observed: Record<string, string[]>,
    symbols: ReplaySymbolTable,
    presenceCode: 'query-presence-mismatch' | 'header-presence-mismatch',
    valueCode: 'query-value-mismatch' | 'header-value-mismatch'
): ReplayRequestMatchResult {
    for (const key of matcher.present) {
        if (!hasOwn(observed, key)) {
            return { matched: false, code: presenceCode };
        }
    }
    for (const key of matcher.absent) {
        if (hasOwn(observed, key)) {
            return { matched: false, code: presenceCode };
        }
    }
    for (const [key, expected] of Object.entries(matcher.exact)) {
        if (
            !hasOwn(observed, key) ||
            !isDeepStrictEqual(
                observed[key],
                resolveExpected(expected, symbols)
            )
        ) {
            return { matched: false, code: valueCode };
        }
    }
    return { matched: true };
}

function matchObjectFields(
    matcher: ReplayFieldMatchers<ReplayTemplateValue>,
    observed: Record<string, unknown>,
    symbols: ReplaySymbolTable
): ReplayRequestMatchResult {
    for (const key of matcher.present) {
        if (!hasOwn(observed, key)) {
            return { matched: false, code: 'body-presence-mismatch' };
        }
    }
    for (const key of matcher.absent) {
        if (hasOwn(observed, key)) {
            return { matched: false, code: 'body-presence-mismatch' };
        }
    }
    for (const [key, expected] of Object.entries(matcher.exact)) {
        if (
            !hasOwn(observed, key) ||
            !isDeepStrictEqual(observed[key], symbols.resolveValue(expected))
        ) {
            return { matched: false, code: 'body-value-mismatch' };
        }
    }
    return { matched: true };
}

function matchCookieAttributes(
    expected: ReplayCookieAttributeMatchers,
    observed: ReplayObservedCookie | undefined,
    symbols: ReplaySymbolTable
): boolean {
    if (observed === undefined) {
        return false;
    }
    const actual = observed.attributes ?? {};
    return Object.entries(expected).every(([attribute, expectedValue]) => {
        const resolved =
            typeof expectedValue === 'object' ||
            typeof expectedValue === 'string'
                ? symbols.resolveString(expectedValue as ReplayTemplateString)
                : expectedValue;
        return isDeepStrictEqual(
            actual[attribute as keyof typeof actual],
            resolved
        );
    });
}

function matchCookies(
    expectation: ReplayExpectation,
    observed: ReplayObservedRequest,
    symbols: ReplaySymbolTable
): ReplayRequestMatchResult {
    const matcher = expectation.request.cookies;
    for (const name of matcher.present) {
        if (!hasOwn(observed.cookies, name)) {
            return { matched: false, code: 'cookie-presence-mismatch' };
        }
    }
    for (const name of matcher.absent) {
        if (hasOwn(observed.cookies, name)) {
            return { matched: false, code: 'cookie-presence-mismatch' };
        }
    }
    for (const [name, expected] of Object.entries(matcher.exact)) {
        const observedCookie = observed.cookies[name];
        if (
            !hasOwn(observed.cookies, name) ||
            observedCookie === undefined ||
            observedCookie.value !== symbols.resolveString(expected)
        ) {
            return { matched: false, code: 'cookie-value-mismatch' };
        }
    }
    for (const [name, attributes] of Object.entries(matcher.attributes)) {
        if (
            !matchCookieAttributes(attributes, observed.cookies[name], symbols)
        ) {
            return { matched: false, code: 'cookie-attribute-mismatch' };
        }
    }
    return { matched: true };
}

function matchBody(
    expectation: ReplayExpectation,
    observed: ReplayObservedRequest,
    symbols: ReplaySymbolTable
): ReplayRequestMatchResult {
    const matcher = expectation.request.body;
    if (matcher.kind !== observed.body.kind) {
        return { matched: false, code: 'body-kind-mismatch' };
    }
    switch (matcher.kind) {
        case 'absent':
            return { matched: true };
        case 'text':
            return observed.body.kind === 'text' &&
                observed.body.value === symbols.resolveString(matcher.exact)
                ? { matched: true }
                : { matched: false, code: 'body-value-mismatch' };
        case 'form':
            return observed.body.kind === 'form'
                ? matchObjectFields(
                      matcher as ReplayFieldMatchers<ReplayTemplateValue>,
                      observed.body.value,
                      symbols
                  )
                : { matched: false, code: 'body-kind-mismatch' };
        case 'json':
            if (
                observed.body.kind !== 'json' ||
                observed.body.value === null ||
                Array.isArray(observed.body.value) ||
                typeof observed.body.value !== 'object'
            ) {
                return { matched: false, code: 'body-kind-mismatch' };
            }
            return matchObjectFields(matcher, observed.body.value, symbols);
    }
}

export function matchReplayRequest(
    expectation: ReplayExpectation,
    observed: ReplayObservedRequest,
    symbols: ReplaySymbolTable
): ReplayRequestMatchResult {
    if (expectation.origin !== observed.origin) {
        return { matched: false, code: 'origin-mismatch' };
    }
    if (expectation.method !== observed.method) {
        return { matched: false, code: 'method-mismatch' };
    }
    if (expectation.path !== observed.path) {
        return { matched: false, code: 'path-mismatch' };
    }

    const query = matchStringFields(
        expectation.request.query,
        observed.query,
        symbols,
        'query-presence-mismatch',
        'query-value-mismatch'
    );
    if (!query.matched) {
        return query;
    }
    const headers = matchStringFields(
        expectation.request.headers,
        observed.headers,
        symbols,
        'header-presence-mismatch',
        'header-value-mismatch'
    );
    if (!headers.matched) {
        return headers;
    }
    const cookies = matchCookies(expectation, observed, symbols);
    if (!cookies.matched) {
        return cookies;
    }
    return matchBody(expectation, observed, symbols);
}
