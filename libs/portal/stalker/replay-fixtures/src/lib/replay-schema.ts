/* eslint-disable max-lines -- Keep the security-sensitive v1 fixture grammar and its fail-closed checks in one auditable validator. */
import {
    REPLAY_COOKIE_ATTRIBUTE_NAMES,
    REPLAY_HTTP_METHODS,
    REPLAY_MAX_EXPECTATIONS,
    REPLAY_MAX_FIXTURE_BYTES,
    REPLAY_MAX_GENERATED_BODY_BYTES,
    REPLAY_MAX_ORIGINS,
    REPLAY_MAX_PENDING_BARRIER_BYTES,
    REPLAY_MAX_PHASES,
    REPLAY_MAX_REQUESTS,
    REPLAY_SCHEMA_VERSION,
    REPLAY_SYMBOL_VALUE_KINDS,
} from './replay.constants.js';
import {
    ReplayFixtureV1,
    ReplayGenerateNode,
    ReplayTemplateString,
} from './replay.types.js';

export interface ReplaySchemaIssue {
    code: string;
    path: string;
    message: string;
}

function schemaErrorMessage(issues: ReplaySchemaIssue[]): string {
    const firstIssue = issues[0];
    return firstIssue === undefined
        ? 'Replay fixture is invalid.'
        : `Replay fixture is invalid: ${firstIssue.code} at ${firstIssue.path}.`;
}

export class ReplaySchemaError extends Error {
    constructor(readonly issues: ReplaySchemaIssue[]) {
        super(schemaErrorMessage(issues));
        this.name = 'ReplaySchemaError';
    }
}

interface ValidationContext {
    issues: ReplaySchemaIssue[];
    symbols: Set<string>;
    declaredSymbols: Set<string>;
}

const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ORIGIN = /^[a-z][a-z0-9-]{0,31}$/;
const LOWER_CASE_HEADER = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;
const JSONP_CALLBACK = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const FREE_FORM_INTERPOLATION = /\$\{|{{|<%|%\{/;
const LOCATION_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const MAX_RENDERED_SYMBOL_BYTES = 128;
const MAX_RENDERED_ORIGIN_BASE_BYTES = 256;

function hasLocationControlOrBackslash(value: string): boolean {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return character === '\\' || code <= 31 || code === 127;
    });
}

function issue(
    context: ValidationContext,
    code: string,
    path: string,
    message: string
): void {
    context.issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
    value: Record<string, unknown>,
    allowed: readonly string[]
): boolean {
    const allowedKeys = new Set(allowed);
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateSafeString(
    value: unknown,
    path: string,
    context: ValidationContext,
    code = 'invalid-label'
): value is string {
    if (typeof value !== 'string' || !SAFE_LABEL.test(value)) {
        issue(context, code, path, 'Expected a bounded safe label.');
        return false;
    }
    return true;
}

function validateLiteralString(
    value: unknown,
    path: string,
    context: ValidationContext
): value is string {
    if (typeof value !== 'string') {
        issue(context, 'invalid-string', path, 'Expected a string.');
        return false;
    }
    if (FREE_FORM_INTERPOLATION.test(value)) {
        issue(
            context,
            'free-form-interpolation',
            path,
            'Use typed ref/parts nodes instead of interpolation.'
        );
        return false;
    }
    return true;
}

function validatePath(
    value: unknown,
    path: string,
    context: ValidationContext
): value is string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 2048 ||
        !value.startsWith('/') ||
        value.includes('?') ||
        value.includes('#') ||
        value.includes('\\') ||
        FREE_FORM_INTERPOLATION.test(value)
    ) {
        issue(
            context,
            'invalid-path',
            path,
            'Expected a bounded absolute path without query, fragment, or interpolation.'
        );
        return false;
    }
    return true;
}

function validateRefNode(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (
        !isRecord(value) ||
        value['kind'] !== 'ref' ||
        !hasExactKeys(value, ['kind', 'symbol'])
    ) {
        issue(context, 'invalid-symbol', path, 'Expected a typed ref node.');
        return false;
    }
    if (
        !validateSafeString(
            value['symbol'],
            `${path}.symbol`,
            context,
            'invalid-symbol'
        )
    ) {
        return false;
    }
    if (!context.symbols.has(value['symbol'])) {
        issue(
            context,
            'unknown-symbol',
            `${path}.symbol`,
            'References must name a generated run-scoped symbol.'
        );
        return false;
    }
    return true;
}

function validateGenerateNode(
    value: unknown,
    path: string,
    context: ValidationContext,
    register: boolean
): value is ReplayGenerateNode {
    if (
        !isRecord(value) ||
        value['kind'] !== 'generate' ||
        !hasExactKeys(value, ['kind', 'symbol', 'valueKind'])
    ) {
        issue(
            context,
            'invalid-symbol',
            path,
            'Expected a typed generate node.'
        );
        return false;
    }
    const validSymbol = validateSafeString(
        value['symbol'],
        `${path}.symbol`,
        context,
        'invalid-symbol'
    );
    if (
        typeof value['valueKind'] !== 'string' ||
        !REPLAY_SYMBOL_VALUE_KINDS.includes(
            value['valueKind'] as (typeof REPLAY_SYMBOL_VALUE_KINDS)[number]
        )
    ) {
        issue(
            context,
            'invalid-symbol',
            `${path}.valueKind`,
            'Unknown generated symbol value kind.'
        );
        return false;
    }
    if (validSymbol && register) {
        if (context.declaredSymbols.has(value['symbol'] as string)) {
            issue(
                context,
                'duplicate-symbol',
                `${path}.symbol`,
                'A generated symbol name may be declared only once.'
            );
            return false;
        }
        context.declaredSymbols.add(value['symbol'] as string);
        context.symbols.add(value['symbol'] as string);
    }
    return validSymbol;
}

function validatePartsNode(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (
        !isRecord(value) ||
        value['kind'] !== 'parts' ||
        !hasExactKeys(value, ['kind', 'parts']) ||
        !Array.isArray(value['parts']) ||
        value['parts'].length === 0 ||
        value['parts'].length > 64
    ) {
        issue(
            context,
            'invalid-symbol',
            path,
            'Expected a non-empty typed parts node.'
        );
        return false;
    }

    let valid = true;
    value['parts'].forEach((part, index) => {
        const partPath = `${path}.parts[${index}]`;
        if (!isRecord(part)) {
            issue(
                context,
                'invalid-symbol',
                partPath,
                'Parts may contain only literal and ref nodes.'
            );
            valid = false;
            return;
        }
        if (part['kind'] === 'literal') {
            if (
                !hasExactKeys(part, ['kind', 'value']) ||
                !validateLiteralString(
                    part['value'],
                    `${partPath}.value`,
                    context
                )
            ) {
                issue(
                    context,
                    'invalid-symbol',
                    partPath,
                    'Literal parts require exactly kind and value.'
                );
                valid = false;
            }
            return;
        }
        if (part['kind'] === 'ref') {
            valid = validateRefNode(part, partPath, context) && valid;
            return;
        }
        issue(
            context,
            'invalid-symbol',
            partPath,
            'Parts may contain only literal and ref nodes.'
        );
        valid = false;
    });
    return valid;
}

function validateTemplateString(
    value: unknown,
    path: string,
    context: ValidationContext,
    allowGenerate: boolean
): value is ReplayTemplateString {
    if (typeof value === 'string') {
        return validateLiteralString(value, path, context);
    }
    if (!isRecord(value)) {
        issue(
            context,
            'invalid-symbol',
            path,
            'Expected a literal string or a typed symbol node.'
        );
        return false;
    }
    if (value['kind'] === 'ref') {
        return validateRefNode(value, path, context);
    }
    if (value['kind'] === 'parts') {
        return validatePartsNode(value, path, context);
    }
    if (value['kind'] === 'generate' && allowGenerate) {
        return validateGenerateNode(value, path, context, true);
    }
    issue(
        context,
        'invalid-symbol',
        path,
        'Expected a literal string or an allowed typed symbol node.'
    );
    return false;
}

function validateTemplateValue(
    value: unknown,
    path: string,
    context: ValidationContext,
    allowGenerate: boolean,
    depth = 0
): boolean {
    if (depth > 64) {
        issue(
            context,
            'template-too-deep',
            path,
            'Template nesting exceeds the deterministic limit.'
        );
        return false;
    }
    if (
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return true;
    }
    if (typeof value === 'string') {
        return validateLiteralString(value, path, context);
    }
    if (Array.isArray(value)) {
        return value.reduce(
            (valid, item, index) =>
                validateTemplateValue(
                    item,
                    `${path}[${index}]`,
                    context,
                    allowGenerate,
                    depth + 1
                ) && valid,
            true
        );
    }
    if (!isRecord(value)) {
        issue(
            context,
            'invalid-template',
            path,
            'Expected JSON template data.'
        );
        return false;
    }

    if (value['kind'] === 'ref') {
        return validateRefNode(value, path, context);
    }
    if (value['kind'] === 'parts') {
        return validatePartsNode(value, path, context);
    }
    if (value['kind'] === 'generate') {
        if (!allowGenerate) {
            issue(
                context,
                'invalid-symbol',
                path,
                'Request matchers cannot generate values.'
            );
            return false;
        }
        return validateGenerateNode(value, path, context, true);
    }

    return Object.entries(value).reduce(
        (valid, [key, item]) =>
            validateLiteralString(key, `${path}.<key>`, context) &&
            validateTemplateValue(
                item,
                `${path}.${key}`,
                context,
                allowGenerate,
                depth + 1
            ) &&
            valid,
        true
    );
}

function validateStringList(
    value: unknown,
    path: string,
    context: ValidationContext,
    lowerCase = false
): value is string[] {
    if (!Array.isArray(value)) {
        issue(context, 'invalid-matchers', path, 'Expected an array of keys.');
        return false;
    }
    let valid = true;
    const seen = new Set<string>();
    value.forEach((item, index) => {
        if (
            typeof item !== 'string' ||
            item.length === 0 ||
            (lowerCase && item !== item.toLowerCase()) ||
            seen.has(item)
        ) {
            issue(
                context,
                'invalid-matchers',
                `${path}[${index}]`,
                'Matcher keys must be unique non-empty strings.'
            );
            valid = false;
        } else {
            seen.add(item);
        }
    });
    return valid;
}

function validateFieldMatchers(
    value: unknown,
    path: string,
    context: ValidationContext,
    options: {
        lowerCaseKeys?: boolean;
        allowArrays?: boolean;
        allowJson?: boolean;
    } = {}
): boolean {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['exact', 'present', 'absent']) ||
        !isRecord(value['exact'])
    ) {
        issue(
            context,
            'invalid-matchers',
            path,
            'Expected exact, present, and absent matcher sets.'
        );
        return false;
    }

    let valid =
        validateStringList(
            value['present'],
            `${path}.present`,
            context,
            options.lowerCaseKeys
        ) &&
        validateStringList(
            value['absent'],
            `${path}.absent`,
            context,
            options.lowerCaseKeys
        );

    const allKeys = [
        ...Object.keys(value['exact']),
        ...((value['present'] as string[]) ?? []),
        ...((value['absent'] as string[]) ?? []),
    ];
    if (new Set(allKeys).size !== allKeys.length) {
        issue(
            context,
            'invalid-matchers',
            path,
            'A matcher key cannot appear in more than one set.'
        );
        valid = false;
    }

    for (const [key, expected] of Object.entries(value['exact'])) {
        if (
            key.length === 0 ||
            (options.lowerCaseKeys && key !== key.toLowerCase())
        ) {
            issue(
                context,
                'invalid-matchers',
                `${path}.exact`,
                'Matcher keys must be non-empty and normalized.'
            );
            valid = false;
            continue;
        }
        if (options.allowArrays && Array.isArray(expected)) {
            if (
                expected.length === 0 ||
                !expected.every((item, index) =>
                    validateTemplateString(
                        item,
                        `${path}.exact.${key}[${index}]`,
                        context,
                        false
                    )
                )
            ) {
                valid = false;
            }
        } else if (options.allowJson) {
            valid =
                validateTemplateValue(
                    expected,
                    `${path}.exact.${key}`,
                    context,
                    false
                ) && valid;
        } else {
            valid =
                validateTemplateString(
                    expected,
                    `${path}.exact.${key}`,
                    context,
                    false
                ) && valid;
        }
    }

    return valid;
}

function validateCookieMatchers(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['exact', 'present', 'absent', 'attributes'])
    ) {
        issue(
            context,
            'invalid-cookie-matchers',
            path,
            'Expected cookie value and attribute matchers.'
        );
        return false;
    }
    const base = {
        exact: value['exact'],
        present: value['present'],
        absent: value['absent'],
    };
    let valid = validateFieldMatchers(base, path, context);
    if (!isRecord(value['attributes'])) {
        issue(
            context,
            'invalid-cookie-matchers',
            `${path}.attributes`,
            'Expected cookie attribute matcher map.'
        );
        return false;
    }

    for (const [cookieName, attributes] of Object.entries(
        value['attributes']
    )) {
        if (!isRecord(attributes)) {
            issue(
                context,
                'invalid-cookie-matchers',
                `${path}.attributes.${cookieName}`,
                'Expected cookie attributes.'
            );
            valid = false;
            continue;
        }
        if (!hasExactKeys(attributes, REPLAY_COOKIE_ATTRIBUTE_NAMES)) {
            issue(
                context,
                'invalid-cookie-matchers',
                `${path}.attributes.${cookieName}`,
                'Unknown cookie attribute matcher.'
            );
            valid = false;
        }
        for (const [attribute, expected] of Object.entries(attributes)) {
            const attributePath = `${path}.attributes.${cookieName}.${attribute}`;
            if (attribute === 'secure' || attribute === 'httpOnly') {
                if (typeof expected !== 'boolean') {
                    issue(
                        context,
                        'invalid-cookie-matchers',
                        attributePath,
                        'Expected a boolean cookie attribute.'
                    );
                    valid = false;
                }
            } else if (attribute === 'maxAge') {
                if (!Number.isInteger(expected) || (expected as number) < 0) {
                    issue(
                        context,
                        'invalid-cookie-matchers',
                        attributePath,
                        'Expected a non-negative integer maxAge.'
                    );
                    valid = false;
                }
            } else if (attribute === 'sameSite') {
                if (!['strict', 'lax', 'none'].includes(expected as string)) {
                    issue(
                        context,
                        'invalid-cookie-matchers',
                        attributePath,
                        'Expected strict, lax, or none.'
                    );
                    valid = false;
                }
            } else {
                valid =
                    validateTemplateString(
                        expected,
                        attributePath,
                        context,
                        false
                    ) && valid;
            }
        }
    }
    return valid;
}

function validateRequestBody(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (!isRecord(value) || typeof value['kind'] !== 'string') {
        issue(
            context,
            'invalid-request-body',
            path,
            'Expected a discriminated request body matcher.'
        );
        return false;
    }
    if (value['kind'] === 'absent') {
        if (hasExactKeys(value, ['kind'])) {
            return true;
        }
    } else if (value['kind'] === 'json' || value['kind'] === 'form') {
        if (hasExactKeys(value, ['kind', 'exact', 'present', 'absent'])) {
            const matchers = {
                exact: value['exact'],
                present: value['present'],
                absent: value['absent'],
            };
            if (
                validateFieldMatchers(matchers, path, context, {
                    allowJson: value['kind'] === 'json',
                })
            ) {
                return true;
            }
        }
    } else if (value['kind'] === 'text') {
        if (
            hasExactKeys(value, ['kind', 'exact']) &&
            validateTemplateString(
                value['exact'],
                `${path}.exact`,
                context,
                false
            )
        ) {
            return true;
        }
    }
    issue(
        context,
        'invalid-request-body',
        path,
        'Unknown or malformed request body matcher.'
    );
    return false;
}

function hasParentLocationSegment(value: string): boolean {
    const path = value.split(/[?#]/, 1)[0] ?? '';
    return path.split('/').some((segment) => {
        try {
            return decodeURIComponent(segment) === '..';
        } catch {
            return true;
        }
    });
}

function validateLiteralLocation(
    value: unknown,
    path: string,
    context: ValidationContext
): value is string {
    if (
        typeof value !== 'string' ||
        value.startsWith(' ') ||
        value.startsWith('\t') ||
        value.endsWith(' ') ||
        value.endsWith('\t') ||
        hasLocationControlOrBackslash(value) ||
        LOCATION_SCHEME.test(value) ||
        value.startsWith('//') ||
        hasParentLocationSegment(value)
    ) {
        issue(
            context,
            'invalid-redirect-location',
            path,
            'Literal redirects must be clean same-origin relative references without parent traversal.'
        );
        return false;
    }

    try {
        const resolved = new URL(value, 'http://replay.invalid/request');
        if (
            resolved.origin !== 'http://replay.invalid' ||
            resolved.username.length > 0 ||
            resolved.password.length > 0
        ) {
            throw new Error('cross-origin redirect');
        }
    } catch {
        issue(
            context,
            'invalid-redirect-location',
            path,
            'Literal redirect is not a safe same-origin relative reference.'
        );
        return false;
    }
    return true;
}

function validateOriginUrlQuery(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (!isRecord(value)) {
        issue(
            context,
            'invalid-redirect-location',
            path,
            'Named-origin query fields must be an object.'
        );
        return false;
    }

    let valid = true;
    for (const [name, queryValue] of Object.entries(value)) {
        if (
            name.length === 0 ||
            name.length > 256 ||
            hasLocationControlOrBackslash(name) ||
            FREE_FORM_INTERPOLATION.test(name)
        ) {
            issue(
                context,
                'invalid-redirect-location',
                `${path}.${name}`,
                'Named-origin query keys must be bounded literal names.'
            );
            valid = false;
            continue;
        }
        const values = Array.isArray(queryValue) ? queryValue : [queryValue];
        if (values.length === 0) {
            issue(
                context,
                'invalid-redirect-location',
                `${path}.${name}`,
                'Named-origin query arrays cannot be empty.'
            );
            valid = false;
            continue;
        }
        values.forEach((item, index) => {
            valid =
                validateTemplateString(
                    item,
                    `${path}.${name}[${index}]`,
                    context,
                    true
                ) && valid;
        });
    }
    return valid;
}

function validateOriginUrlNode(
    value: Record<string, unknown>,
    path: string,
    context: ValidationContext,
    origins: Set<string>
): boolean {
    if (
        !hasExactKeys(value, [
            'kind',
            'origin',
            'path',
            'userInfo',
            'query',
        ])
    ) {
        issue(
            context,
            'invalid-redirect-location',
            path,
            'Named-origin URL node contains unknown fields.'
        );
        return false;
    }

    let valid = true;
    if (
        typeof value['origin'] !== 'string' ||
        !origins.has(value['origin'])
    ) {
        issue(
            context,
            'unknown-origin',
            `${path}.origin`,
            'Redirect origin must reference a declared named origin.'
        );
        valid = false;
    }
    valid =
        validatePath(value['path'], `${path}.path`, context) &&
        valid;

    if (value['userInfo'] !== undefined) {
        const userInfo = value['userInfo'];
        if (
            !isRecord(userInfo) ||
            !hasExactKeys(userInfo, ['username', 'password']) ||
            !Object.prototype.hasOwnProperty.call(userInfo, 'username')
        ) {
            issue(
                context,
                'invalid-redirect-location',
                `${path}.userInfo`,
                'Named-origin user info requires a typed username and optional password.'
            );
            valid = false;
        } else {
            valid =
                validateTemplateString(
                    userInfo['username'],
                    `${path}.userInfo.username`,
                    context,
                    true
                ) && valid;
            if (userInfo['password'] !== undefined) {
                valid =
                    validateTemplateString(
                        userInfo['password'],
                        `${path}.userInfo.password`,
                        context,
                        true
                    ) && valid;
            }
        }
    }
    if (value['query'] !== undefined) {
        valid =
            validateOriginUrlQuery(
                value['query'],
                `${path}.query`,
                context
            ) && valid;
    }
    return valid;
}

function validateResponseHeaders(
    value: unknown,
    path: string,
    context: ValidationContext,
    origins: Set<string>
): boolean {
    if (!isRecord(value)) {
        issue(
            context,
            'invalid-response-headers',
            path,
            'Expected a lower-case response header map.'
        );
        return false;
    }
    let valid = true;
    for (const [name, values] of Object.entries(value)) {
        if (
            name !== name.toLowerCase() ||
            !LOWER_CASE_HEADER.test(name) ||
            !Array.isArray(values) ||
            values.length === 0
        ) {
            issue(
                context,
                'invalid-response-headers',
                `${path}.${name}`,
                'Response headers require lower-case names and non-empty arrays.'
            );
            valid = false;
            continue;
        }
        values.forEach((headerValue, index) => {
            const headerPath = `${path}.${name}[${index}]`;
            if (
                isRecord(headerValue) &&
                headerValue['kind'] === 'origin-url'
            ) {
                if (name !== 'location') {
                    issue(
                        context,
                        'invalid-redirect-location',
                        headerPath,
                        'Named-origin URL nodes are valid only as Location values.'
                    );
                    valid = false;
                    return;
                }
                valid =
                    validateOriginUrlNode(
                        headerValue,
                        headerPath,
                        context,
                        origins
                    ) && valid;
                return;
            }
            if (name === 'location') {
                if (!validateLiteralLocation(headerValue, headerPath, context)) {
                    valid = false;
                    return;
                }
            }
            valid =
                validateTemplateString(
                    headerValue,
                    headerPath,
                    context,
                    true
                ) && valid;
        });
    }
    return valid;
}

function validateResponseBody(
    value: unknown,
    path: string,
    context: ValidationContext
): boolean {
    if (!isRecord(value) || typeof value['kind'] !== 'string') {
        issue(
            context,
            'invalid-response-body',
            path,
            'Expected a discriminated response body.'
        );
        return false;
    }

    let valid = true;
    switch (value['kind']) {
        case 'empty':
            valid = hasExactKeys(value, ['kind']);
            break;
        case 'json':
            valid =
                hasExactKeys(value, ['kind', 'value']) &&
                validateTemplateValue(
                    value['value'],
                    `${path}.value`,
                    context,
                    true
                );
            break;
        case 'jsonp':
            valid =
                hasExactKeys(value, ['kind', 'callback', 'value']) &&
                typeof value['callback'] === 'string' &&
                JSONP_CALLBACK.test(value['callback']) &&
                !['__proto__', 'constructor', 'prototype'].includes(
                    value['callback']
                ) &&
                validateTemplateValue(
                    value['value'],
                    `${path}.value`,
                    context,
                    true
                );
            break;
        case 'text':
            valid =
                hasExactKeys(value, ['kind', 'value']) &&
                validateTemplateString(
                    value['value'],
                    `${path}.value`,
                    context,
                    true
                );
            break;
        case 'generated':
            if (
                !hasExactKeys(value, ['kind', 'byteLength', 'byte']) ||
                !Number.isInteger(value['byteLength']) ||
                (value['byteLength'] as number) < 0 ||
                !Number.isInteger(value['byte']) ||
                (value['byte'] as number) < 0 ||
                (value['byte'] as number) > 255
            ) {
                valid = false;
            } else if (
                (value['byteLength'] as number) >
                REPLAY_MAX_GENERATED_BODY_BYTES
            ) {
                issue(
                    context,
                    'generated-body-too-large',
                    `${path}.byteLength`,
                    'Generated response exceeds the 16 MiB limit.'
                );
                return false;
            }
            break;
        default:
            valid = false;
    }

    if (!valid) {
        issue(
            context,
            'invalid-response-body',
            path,
            'Unknown or malformed response body.'
        );
    }
    return valid;
}

function validateResponse(
    value: unknown,
    path: string,
    context: ValidationContext,
    origins: Set<string>
): boolean {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['status', 'headers', 'body'])
    ) {
        issue(
            context,
            'invalid-response',
            path,
            'Expected status, headers, and body.'
        );
        return false;
    }
    let valid = true;
    if (
        !Number.isInteger(value['status']) ||
        (value['status'] as number) < 100 ||
        (value['status'] as number) > 599
    ) {
        issue(
            context,
            'invalid-response',
            `${path}.status`,
            'Expected an HTTP status from 100 through 599.'
        );
        valid = false;
    }
    return (
        validateResponseHeaders(
            value['headers'],
            `${path}.headers`,
            context,
            origins
        ) &&
        validateResponseBody(value['body'], `${path}.body`, context) &&
        valid
    );
}

function boundedByteSum(left: number, right: number): number {
    return Math.min(
        REPLAY_MAX_PENDING_BARRIER_BYTES + 1,
        left + right
    );
}

function renderedTemplateStringUpperBound(value: unknown): number {
    if (typeof value === 'string') {
        return Buffer.byteLength(value);
    }
    if (!isRecord(value)) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    if (value['kind'] === 'generate' || value['kind'] === 'ref') {
        return MAX_RENDERED_SYMBOL_BYTES;
    }
    if (value['kind'] !== 'parts' || !Array.isArray(value['parts'])) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    return value['parts'].reduce<number>((total, part) => {
        if (
            isRecord(part) &&
            part['kind'] === 'literal' &&
            typeof part['value'] === 'string'
        ) {
            return boundedByteSum(total, Buffer.byteLength(part['value']));
        }
        return boundedByteSum(total, MAX_RENDERED_SYMBOL_BYTES);
    }, 0);
}

function renderedJsonStringUpperBound(value: unknown): number {
    if (typeof value === 'string') {
        return Math.max(0, Buffer.byteLength(JSON.stringify(value)) - 2);
    }
    if (!isRecord(value)) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    if (value['kind'] === 'generate' || value['kind'] === 'ref') {
        return MAX_RENDERED_SYMBOL_BYTES * 6;
    }
    if (value['kind'] !== 'parts' || !Array.isArray(value['parts'])) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    return value['parts'].reduce<number>((total, part) => {
        if (
            isRecord(part) &&
            part['kind'] === 'literal' &&
            typeof part['value'] === 'string'
        ) {
            return boundedByteSum(
                total,
                Math.max(
                    0,
                    Buffer.byteLength(JSON.stringify(part['value'])) - 2
                )
            );
        }
        return boundedByteSum(total, MAX_RENDERED_SYMBOL_BYTES * 6);
    }, 0);
}

function renderedTemplateJsonUpperBound(
    value: unknown,
    depth = 0
): number {
    if (depth > 64) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string'
    ) {
        return Buffer.byteLength(JSON.stringify(value));
    }
    if (Array.isArray(value)) {
        return value.reduce(
            (total, item, index) =>
                boundedByteSum(
                    boundedByteSum(total, index === 0 ? 0 : 1),
                    renderedTemplateJsonUpperBound(item, depth + 1)
                ),
            2
        );
    }
    if (!isRecord(value)) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    if (
        value['kind'] === 'generate' ||
        value['kind'] === 'ref' ||
        value['kind'] === 'parts'
    ) {
        return boundedByteSum(
            renderedJsonStringUpperBound(value),
            2
        );
    }
    return Object.entries(value).reduce(
        (total, [key, item], index) => {
            const keyBytes = Buffer.byteLength(JSON.stringify(key));
            const valueBytes = renderedTemplateJsonUpperBound(
                item,
                depth + 1
            );
            return boundedByteSum(
                boundedByteSum(
                    boundedByteSum(total, index === 0 ? 0 : 1),
                    keyBytes + 1
                ),
                valueBytes
            );
        },
        2
    );
}

function renderedOriginUrlUpperBound(value: Record<string, unknown>): number {
    let total = MAX_RENDERED_ORIGIN_BASE_BYTES;
    total = boundedByteSum(
        total,
        typeof value['path'] === 'string'
            ? Buffer.byteLength(value['path']) * 3
            : REPLAY_MAX_PENDING_BARRIER_BYTES + 1
    );
    if (isRecord(value['userInfo'])) {
        total = boundedByteSum(
            total,
            renderedTemplateStringUpperBound(value['userInfo']['username']) *
                3 +
                2
        );
        if (value['userInfo']['password'] !== undefined) {
            total = boundedByteSum(
                total,
                renderedTemplateStringUpperBound(
                    value['userInfo']['password']
                ) *
                    3 +
                    1
            );
        }
    }
    if (isRecord(value['query'])) {
        for (const [name, queryValue] of Object.entries(value['query'])) {
            const values = Array.isArray(queryValue)
                ? queryValue
                : [queryValue];
            for (const item of values) {
                total = boundedByteSum(
                    total,
                    (Buffer.byteLength(name) +
                        renderedTemplateStringUpperBound(item)) *
                        3 +
                        2
                );
            }
        }
    }
    return total;
}

function renderedHeaderValueUpperBound(value: unknown): number {
    return isRecord(value) && value['kind'] === 'origin-url'
        ? renderedOriginUrlUpperBound(value)
        : renderedTemplateStringUpperBound(value);
}

function renderedResponseUpperBound(expectation: unknown): number {
    if (!isRecord(expectation) || !isRecord(expectation['response'])) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    const response = expectation['response'];
    let total = 0;
    if (isRecord(response['headers'])) {
        for (const [name, values] of Object.entries(response['headers'])) {
            if (!Array.isArray(values)) {
                return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
            }
            for (const value of values) {
                total = boundedByteSum(
                    total,
                    Buffer.byteLength(name) +
                        renderedHeaderValueUpperBound(value) +
                        4
                );
            }
        }
    }

    const body = response['body'];
    if (!isRecord(body)) {
        return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
    switch (body['kind']) {
        case 'empty':
            return total;
        case 'generated':
            return boundedByteSum(
                total,
                typeof body['byteLength'] === 'number'
                    ? body['byteLength']
                    : REPLAY_MAX_PENDING_BARRIER_BYTES + 1
            );
        case 'text':
            return boundedByteSum(
                total,
                renderedTemplateStringUpperBound(body['value'])
            );
        case 'json':
            return boundedByteSum(
                total,
                renderedTemplateJsonUpperBound(body['value'])
            );
        case 'jsonp':
            return boundedByteSum(
                total,
                (typeof body['callback'] === 'string'
                    ? Buffer.byteLength(body['callback'])
                    : REPLAY_MAX_PENDING_BARRIER_BYTES + 1) +
                    renderedTemplateJsonUpperBound(body['value']) +
                    3
            );
        default:
            return REPLAY_MAX_PENDING_BARRIER_BYTES + 1;
    }
}

function pendingBarrierUpperBound(
    expectations: unknown[],
    releaseWhenMatched: number
): number {
    const responseSizes: number[] = [];
    for (const expectation of expectations) {
        if (
            !isRecord(expectation) ||
            !isRecord(expectation['cardinality']) ||
            !Number.isInteger(expectation['cardinality']['max'])
        ) {
            continue;
        }
        const cardinality = Math.min(
            expectation['cardinality']['max'] as number,
            REPLAY_MAX_REQUESTS
        );
        const responseSize = renderedResponseUpperBound(expectation);
        for (let index = 0; index < cardinality; index += 1) {
            responseSizes.push(responseSize);
        }
    }
    responseSizes.sort((left, right) => right - left);
    return responseSizes
        .slice(0, releaseWhenMatched)
        .reduce(boundedByteSum, 0);
}

function validateExpectation(
    value: unknown,
    path: string,
    context: ValidationContext,
    origins: Set<string>,
    ids: Set<string>
): number {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, [
            'id',
            'operation',
            'origin',
            'method',
            'path',
            'request',
            'response',
            'cardinality',
        ])
    ) {
        issue(
            context,
            'invalid-expectation',
            path,
            'Expectation shape is invalid.'
        );
        return 0;
    }

    validateSafeString(
        value['id'],
        `${path}.id`,
        context,
        'invalid-expectation'
    );
    if (typeof value['id'] === 'string') {
        if (ids.has(value['id'])) {
            issue(
                context,
                'duplicate-expectation',
                `${path}.id`,
                'Expectation IDs must be unique.'
            );
        }
        ids.add(value['id']);
    }
    validateSafeString(
        value['operation'],
        `${path}.operation`,
        context,
        'invalid-expectation'
    );
    if (typeof value['origin'] !== 'string' || !origins.has(value['origin'])) {
        issue(
            context,
            'unknown-origin',
            `${path}.origin`,
            'Expectation origin is not declared.'
        );
    }
    if (
        typeof value['method'] !== 'string' ||
        !REPLAY_HTTP_METHODS.includes(
            value['method'] as (typeof REPLAY_HTTP_METHODS)[number]
        )
    ) {
        issue(
            context,
            'invalid-expectation',
            `${path}.method`,
            'Expected an upper-case allowlisted HTTP method.'
        );
    }
    validatePath(value['path'], `${path}.path`, context);

    if (
        !isRecord(value['request']) ||
        !hasExactKeys(value['request'], ['query', 'headers', 'cookies', 'body'])
    ) {
        issue(
            context,
            'invalid-request',
            `${path}.request`,
            'Request matcher shape is invalid.'
        );
    } else {
        validateFieldMatchers(
            value['request']['query'],
            `${path}.request.query`,
            context,
            { allowArrays: true }
        );
        validateFieldMatchers(
            value['request']['headers'],
            `${path}.request.headers`,
            context,
            { lowerCaseKeys: true, allowArrays: true }
        );
        validateCookieMatchers(
            value['request']['cookies'],
            `${path}.request.cookies`,
            context
        );
        validateRequestBody(
            value['request']['body'],
            `${path}.request.body`,
            context
        );
    }

    validateResponse(
        value['response'],
        `${path}.response`,
        context,
        origins
    );

    let cardinalityMinimum = 0;
    if (
        !isRecord(value['cardinality']) ||
        !hasExactKeys(value['cardinality'], ['min', 'max']) ||
        !Number.isInteger(value['cardinality']['min']) ||
        !Number.isInteger(value['cardinality']['max']) ||
        (value['cardinality']['min'] as number) < 1 ||
        (value['cardinality']['max'] as number) <
            (value['cardinality']['min'] as number) ||
        (value['cardinality']['max'] as number) > REPLAY_MAX_REQUESTS
    ) {
        issue(
            context,
            'invalid-cardinality',
            `${path}.cardinality`,
            'Cardinality requires 1 <= min <= max <= request limit.'
        );
    } else {
        cardinalityMinimum = value['cardinality']['min'] as number;
        if (value['cardinality']['min'] !== value['cardinality']['max']) {
            issue(
                context,
                'non-exact-cardinality',
                `${path}.cardinality`,
                'Replay v1 requires exact request cardinality.'
            );
        }
    }

    return cardinalityMinimum;
}

function validateEndpoint(
    value: unknown,
    path: string,
    context: ValidationContext,
    origins: Set<string>
): boolean {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['origin', 'path']) ||
        typeof value['origin'] !== 'string' ||
        !origins.has(value['origin'])
    ) {
        issue(
            context,
            'unknown-origin',
            path,
            'Endpoint must reference a named origin.'
        );
        return false;
    }
    return validatePath(value['path'], `${path}.path`, context);
}

function validateFixture(value: unknown): ReplayFixtureV1 {
    const context: ValidationContext = {
        issues: [],
        symbols: new Set(),
        declaredSymbols: new Set(),
    };
    if (!isRecord(value)) {
        throw new ReplaySchemaError([
            {
                code: 'invalid-fixture',
                path: '$',
                message: 'Fixture root must be a JSON object.',
            },
        ]);
    }

    const rootKeys = [
        'schemaVersion',
        'scenarioId',
        'description',
        'origins',
        'entry',
        'expectedEndpoint',
        'initialState',
        'terminalState',
        'failOnUnexpectedRequest',
        'symbols',
        'phases',
    ];
    if (!hasExactKeys(value, rootKeys)) {
        issue(
            context,
            'invalid-fixture',
            '$',
            'Fixture contains unknown root fields.'
        );
    }
    if (value['schemaVersion'] !== REPLAY_SCHEMA_VERSION) {
        issue(
            context,
            'unsupported-schema-version',
            '$.schemaVersion',
            'Only deterministic replay schema v1 is supported.'
        );
    }
    validateSafeString(
        value['scenarioId'],
        '$.scenarioId',
        context,
        'invalid-scenario-id'
    );
    if (
        value['description'] !== undefined &&
        typeof value['description'] !== 'string'
    ) {
        issue(
            context,
            'invalid-fixture',
            '$.description',
            'Description must be a string.'
        );
    }

    const origins = new Set<string>();
    if (
        !isRecord(value['origins']) ||
        Object.keys(value['origins']).length === 0
    ) {
        issue(
            context,
            'invalid-origins',
            '$.origins',
            'At least one named origin is required.'
        );
    } else {
        if (Object.keys(value['origins']).length > REPLAY_MAX_ORIGINS) {
            issue(
                context,
                'too-many-origins',
                '$.origins',
                'Scenario exceeds the eight-origin listener limit.'
            );
        }
        for (const [name, origin] of Object.entries(value['origins'])) {
            if (!SAFE_ORIGIN.test(name)) {
                issue(
                    context,
                    'invalid-origins',
                    `$.origins.${name}`,
                    'Origin names must be bounded lower-case labels.'
                );
            }
            origins.add(name);
            if (
                !isRecord(origin) ||
                !hasExactKeys(origin, ['description']) ||
                (origin['description'] !== undefined &&
                    typeof origin['description'] !== 'string')
            ) {
                issue(
                    context,
                    'invalid-origins',
                    `$.origins.${name}`,
                    'Origin definition is invalid.'
                );
            }
        }
    }

    validateEndpoint(value['entry'], '$.entry', context, origins);
    validateEndpoint(
        value['expectedEndpoint'],
        '$.expectedEndpoint',
        context,
        origins
    );
    validateSafeString(
        value['initialState'],
        '$.initialState',
        context,
        'invalid-state'
    );
    validateSafeString(
        value['terminalState'],
        '$.terminalState',
        context,
        'invalid-state'
    );
    if (typeof value['failOnUnexpectedRequest'] !== 'boolean') {
        issue(
            context,
            'invalid-fixture',
            '$.failOnUnexpectedRequest',
            'Unexpected-request policy must be explicit.'
        );
    }

    if (!Array.isArray(value['symbols'])) {
        issue(
            context,
            'invalid-symbol',
            '$.symbols',
            'Expected generated symbol declarations.'
        );
    } else {
        value['symbols'].forEach((symbol, index) =>
            validateGenerateNode(symbol, `$.symbols[${index}]`, context, true)
        );
    }

    if (!Array.isArray(value['phases']) || value['phases'].length === 0) {
        issue(
            context,
            'invalid-phases',
            '$.phases',
            'At least one ordered phase is required.'
        );
    } else {
        if (value['phases'].length > REPLAY_MAX_PHASES) {
            issue(
                context,
                'too-many-phases',
                '$.phases',
                'Scenario exceeds the 128-phase limit.'
            );
        }
        let expectationCount = 0;
        let minimumRequestCount = 0;
        let expectedState = value['initialState'];
        const phaseNames = new Set<string>();
        const expectationIds = new Set<string>();

        value['phases'].forEach((phase, phaseIndex) => {
            const phasePath = `$.phases[${phaseIndex}]`;
            if (
                !isRecord(phase) ||
                !hasExactKeys(phase, [
                    'name',
                    'state',
                    'nextState',
                    'mode',
                    'barrier',
                    'expectations',
                ])
            ) {
                issue(
                    context,
                    'invalid-phase',
                    phasePath,
                    'Phase shape is invalid.'
                );
                return;
            }
            if (
                validateSafeString(
                    phase['name'],
                    `${phasePath}.name`,
                    context,
                    'invalid-phase'
                )
            ) {
                if (phaseNames.has(phase['name'])) {
                    issue(
                        context,
                        'duplicate-phase',
                        `${phasePath}.name`,
                        'Phase names must be unique.'
                    );
                }
                phaseNames.add(phase['name']);
            }
            if (phase['state'] !== expectedState) {
                issue(
                    context,
                    'invalid-state-transition',
                    `${phasePath}.state`,
                    'Phases must form a deterministic state chain.'
                );
            }
            validateSafeString(
                phase['state'],
                `${phasePath}.state`,
                context,
                'invalid-state'
            );
            if (
                validateSafeString(
                    phase['nextState'],
                    `${phasePath}.nextState`,
                    context,
                    'invalid-state'
                )
            ) {
                expectedState = phase['nextState'];
            }
            if (!['ordered', 'unordered'].includes(phase['mode'] as string)) {
                issue(
                    context,
                    'invalid-phase',
                    `${phasePath}.mode`,
                    'Phase mode must be ordered or unordered.'
                );
            }
            if (
                !Array.isArray(phase['expectations']) ||
                phase['expectations'].length === 0
            ) {
                issue(
                    context,
                    'invalid-phase',
                    `${phasePath}.expectations`,
                    'A phase requires at least one expectation.'
                );
                return;
            }

            expectationCount += phase['expectations'].length;
            let phaseMinimum = 0;
            const phaseStartingSymbols = new Set(context.symbols);
            const phaseGeneratedSymbols = new Set<string>();
            phase['expectations'].forEach((expectation, expectationIndex) => {
                const expectationContext =
                    phase['mode'] === 'unordered'
                        ? {
                              issues: context.issues,
                              symbols: new Set(phaseStartingSymbols),
                              declaredSymbols: context.declaredSymbols,
                          }
                        : context;
                const expectationMinimum = validateExpectation(
                    expectation,
                    `${phasePath}.expectations[${expectationIndex}]`,
                    expectationContext,
                    origins,
                    expectationIds
                );
                phaseMinimum += expectationMinimum;
                minimumRequestCount += expectationMinimum;
                if (phase['mode'] === 'unordered') {
                    for (const symbol of expectationContext.symbols) {
                        if (!phaseStartingSymbols.has(symbol)) {
                            phaseGeneratedSymbols.add(symbol);
                        }
                    }
                }
            });
            phaseGeneratedSymbols.forEach((symbol) =>
                context.symbols.add(symbol)
            );

            if (phase['barrier'] !== undefined) {
                const barrier = phase['barrier'];
                if (
                    !isRecord(barrier) ||
                    !hasExactKeys(barrier, ['name', 'releaseWhenMatched']) ||
                    !validateSafeString(
                        barrier['name'],
                        `${phasePath}.barrier.name`,
                        context,
                        'invalid-barrier'
                    ) ||
                    !Number.isInteger(barrier['releaseWhenMatched']) ||
                    (barrier['releaseWhenMatched'] as number) < 1 ||
                    (barrier['releaseWhenMatched'] as number) > phaseMinimum
                ) {
                    issue(
                        context,
                        'invalid-barrier',
                        `${phasePath}.barrier`,
                        'Barrier threshold must be reachable by minimum cardinality.'
                    );
                }
                if (
                    isRecord(barrier) &&
                    Number.isInteger(barrier['releaseWhenMatched']) &&
                    (barrier['releaseWhenMatched'] as number) >= 1 &&
                    (barrier['releaseWhenMatched'] as number) <=
                        REPLAY_MAX_REQUESTS &&
                    pendingBarrierUpperBound(
                        phase['expectations'],
                        barrier['releaseWhenMatched'] as number
                    ) > REPLAY_MAX_PENDING_BARRIER_BYTES
                ) {
                    issue(
                        context,
                        'pending-barrier-too-large',
                        `${phasePath}.barrier`,
                        'Barrier can retain more than the bounded pending-response budget.'
                    );
                }
            }
        });

        if (expectationCount > REPLAY_MAX_EXPECTATIONS) {
            issue(
                context,
                'too-many-expectations',
                '$.phases',
                'Scenario exceeds the 512-expectation limit.'
            );
        }
        if (minimumRequestCount > REPLAY_MAX_REQUESTS) {
            issue(
                context,
                'too-many-requests',
                '$.phases',
                'Scenario minimum cardinality exceeds the 512-request run limit.'
            );
        }
        if (expectedState !== value['terminalState']) {
            issue(
                context,
                'invalid-state-transition',
                '$.terminalState',
                'The final phase must enter the declared terminal state.'
            );
        }
    }

    if (context.issues.length > 0) {
        throw new ReplaySchemaError(context.issues);
    }
    return value as unknown as ReplayFixtureV1;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
    ) {
        return value;
    }
    const object = value as object;
    if (seen.has(object)) {
        return value;
    }
    seen.add(object);
    for (const nested of Object.values(object)) {
        deepFreeze(nested, seen);
    }
    return Object.freeze(value);
}

function serializeFixture(value: unknown): string {
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw new ReplaySchemaError([
            {
                code: 'invalid-fixture',
                path: '$',
                message: 'Fixture must be deterministic JSON data.',
            },
        ]);
    }
    if (serialized === undefined) {
        throw new ReplaySchemaError([
            {
                code: 'invalid-fixture',
                path: '$',
                message: 'Fixture must be deterministic JSON data.',
            },
        ]);
    }
    return serialized;
}

export function parseReplayFixture(value: unknown): ReplayFixtureV1 {
    if (typeof value === 'string') {
        return parseReplayFixtureText(value);
    }
    const serialized = serializeFixture(value);
    if (Buffer.byteLength(serialized) > REPLAY_MAX_FIXTURE_BYTES) {
        throw new ReplaySchemaError([
            {
                code: 'fixture-too-large',
                path: '$',
                message: 'Fixture exceeds the 1 MiB limit.',
            },
        ]);
    }
    validateFixture(value);
    return deepFreeze(validateFixture(JSON.parse(serialized)));
}

export function parseReplayFixtureText(text: string): ReplayFixtureV1 {
    if (Buffer.byteLength(text) > REPLAY_MAX_FIXTURE_BYTES) {
        throw new ReplaySchemaError([
            {
                code: 'fixture-too-large',
                path: '$',
                message: 'Fixture exceeds the 1 MiB limit.',
            },
        ]);
    }

    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new ReplaySchemaError([
            {
                code: 'invalid-json',
                path: '$',
                message: 'Fixture must contain valid JSON.',
            },
        ]);
    }
    return deepFreeze(validateFixture(value));
}
