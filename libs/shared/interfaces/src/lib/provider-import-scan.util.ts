import { normalizeStalkerMacAddress } from './stalker-mac-address.util';
import { isFullStalkerPortalUrl } from './stalker-portal-mode.util';

/**
 * Low-level scanners for the provider-message auto-detect
 * (`provider-import-detection.util.ts` assembles their findings into
 * candidates). Everything here returns verbatim substrings of the input, or
 * canonical forms produced by the existing shared normalizers.
 */

export type UrlRole = 'xtream-api' | 'm3u' | 'stalker' | 'generic';

export interface DetectedUrl {
    /** Exact substring as found, trailing punctuation stripped. */
    raw: string;
    parsed: URL;
    role: UrlRole;
}

export interface LabeledFields {
    username?: string;
    password?: string;
    /** Raw value of a server/portal/host/url label — URL- or host-shaped. */
    host?: string;
    port?: string;
    macAddress?: string;
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[),.;:!?\]»›]+$/;
const M3U_PATH_PATTERN = /\.m3u8?$/i;
const XTREAM_API_PATH_PATTERN = /\/(?:get|player_api|panel_api)\.php$/i;
const STALKER_PATH_PATTERN = /\/(?:portal\.php|c\/?)$/i;

// Uniform-separator MAC (00:1A:79:AA:BB:CC, hyphens or dots alike). The
// backreference rejects mixed separators, and because `\b` never sits between
// two word characters a MAC-shaped window inside a longer hex blob (a 64-hex
// device ID) cannot match.
const SEPARATED_MAC_PATTERN = /\b[0-9A-F]{2}([:.-])[0-9A-F]{2}(?:\1[0-9A-F]{2}){4}\b/gi;
// A bare 12-hex run is only trusted as a MAC when it carries Infomir's OUI —
// any 12 hex digits would false-positive on ids, tokens and hashes.
const BARE_INFOMIR_MAC_PATTERN = /\b001A79[0-9A-F]{6}\b/gi;

/** Hex-shaped identity values (device IDs / signatures are SHA-256 hex). */
const HEX_IDENTITY_PATTERN = /^[0-9A-Fa-f]{16,64}$/;
const HOSTISH_PATTERN = /^[a-z0-9][a-z0-9.-]*(?::\d{2,5})?$/i;

const WRAPPING_CHARS = /^["'`«<([]+|["'`»>)\]]+$/g;

const MAX_URLS = 8;
const MAX_MACS = 4;

interface FieldMatcher {
    field: keyof LabeledFields;
    pattern: RegExp;
    validate?: (value: string) => boolean;
}

// Order matters only for readability — each matcher targets its own field and
// the numbered variants ("device id 2") are structured so the unnumbered
// pattern cannot swallow them (its optional `1` never matches a literal `2`,
// and the required `:`/`=` separator then fails on the digit).
//
// All matchers require an explicit `:` or `=` separator. Provider messages
// overwhelmingly use "Label: value"; a bare "login example" in prose is
// exactly the false positive the separator rule exists to reject. The label
// vocabulary is deliberately small (English + Russian) until a corpus of
// real provider messages justifies growing it.
const FIELD_MATCHERS: FieldMatcher[] = [
    {
        field: 'deviceId2',
        pattern:
            /(?<![\p{L}\p{N}_])device[\s_-]*id[\s_-]*2\s*[:=]\s*([^\s,;|]+)/iu,
        validate: (value) => HEX_IDENTITY_PATTERN.test(value),
    },
    {
        field: 'deviceId1',
        pattern:
            /(?<![\p{L}\p{N}_])device[\s_-]*id[\s_-]*1?\s*[:=]\s*([^\s,;|]+)/iu,
        validate: (value) => HEX_IDENTITY_PATTERN.test(value),
    },
    {
        field: 'signature2',
        pattern:
            /(?<![\p{L}\p{N}_])sig(?:nature)?[\s_-]*2\s*[:=]\s*([^\s,;|]+)/iu,
        validate: (value) => HEX_IDENTITY_PATTERN.test(value),
    },
    {
        field: 'signature1',
        pattern:
            /(?<![\p{L}\p{N}_])sig(?:nature)?[\s_-]*1?\s*[:=]\s*([^\s,;|]+)/iu,
        validate: (value) => HEX_IDENTITY_PATTERN.test(value),
    },
    {
        field: 'serialNumber',
        pattern:
            /(?<![\p{L}\p{N}_])(?:serial[\s_-]*(?:number|no)?|s\/n|sn|серийный(?:[\s_-]*номер)?)\s*[:=]\s*([^\s,;|]+)/iu,
        validate: (value) => value.length <= 64,
    },
    {
        field: 'macAddress',
        pattern:
            /(?<![\p{L}\p{N}_])(?:mac(?:[\s_-]*address)?|мак(?:[\s_-]*адрес)?)\s*[:=]\s*([0-9A-Fa-f:. -]{12,23})/iu,
        validate: (value) => normalizeStalkerMacAddress(value) !== null,
    },
    {
        field: 'username',
        pattern:
            /(?<![\p{L}\p{N}_])(?:user[\s_-]*name|login|user|логин|пользователь)\s*[:=]\s*([^\s,;|]+)/iu,
    },
    {
        field: 'password',
        pattern:
            /(?<![\p{L}\p{N}_])(?:pass[\s_-]*word|pass|pwd|пароль)\s*[:=]\s*([^\s,;|]+)/iu,
    },
    {
        field: 'host',
        pattern:
            /(?<![\p{L}\p{N}_])(?:server|portal|host|dns|url|сервер|портал|хост|адрес)(?:[\s_-]*(?:url|address|адрес))?\s*[:=]\s*([^\s,;|]+)/iu,
    },
    {
        field: 'port',
        pattern: /(?<![\p{L}\p{N}_])(?:port|порт)\s*[:=]\s*(\d{2,5})\b/iu,
    },
];

/**
 * `String.prototype.matchAll` equivalent — the web build's TS lib target
 * predates it. Works on a fresh RegExp copy so the module-level patterns
 * never carry `lastIndex` state between calls.
 */
function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
    const matcher = new RegExp(pattern.source, pattern.flags);
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
        matches.push(match);
        if (match[0] === '') {
            matcher.lastIndex += 1;
        }
    }
    return matches;
}

export function extractUrls(text: string): DetectedUrl[] {
    const detected: DetectedUrl[] = [];
    const seen = new Set<string>();
    for (const match of allMatches(URL_PATTERN, text)) {
        const raw = match[0].replace(TRAILING_PUNCTUATION, '');
        if (seen.has(raw)) {
            continue;
        }
        let parsed: URL;
        try {
            parsed = new URL(raw);
        } catch {
            continue;
        }
        seen.add(raw);
        detected.push({ raw, parsed, role: classifyUrl(raw, parsed) });
        if (detected.length >= MAX_URLS) {
            break;
        }
    }
    return detected;
}

function classifyUrl(raw: string, parsed: URL): UrlRole {
    if (M3U_PATH_PATTERN.test(parsed.pathname)) {
        return 'm3u';
    }
    if (XTREAM_API_PATH_PATTERN.test(parsed.pathname)) {
        return 'xtream-api';
    }
    if (
        isFullStalkerPortalUrl(raw) ||
        STALKER_PATH_PATTERN.test(parsed.pathname)
    ) {
        return 'stalker';
    }
    return 'generic';
}

export function extractLabeledFields(
    text: string,
    urls: DetectedUrl[]
): LabeledFields {
    // Query strings ARE label-shaped (`?username=u&password=p`), so labeled
    // extraction must never look inside a URL: credentials that ride in a
    // query are mined by `extractXtreamCredentialsFromUrl` with proper URL
    // decoding, and reading them as plain labels would truncate at `&`. Every
    // matcher therefore runs against a copy with URL spans blanked out — with
    // one exception: the host/server label legitimately points AT a URL
    // ("Portal: http://…"), so it reads the raw text, accepting only matches
    // whose label starts outside every URL span (`&url=…` inside a query
    // stays rejected).
    const spans = urlSpans(text, urls);
    const masked = maskSpans(text, spans);
    const fields: LabeledFields = {};
    for (const { field, pattern, validate } of FIELD_MATCHERS) {
        if (fields[field] !== undefined) {
            continue;
        }
        const match = pattern.exec(field === 'host' ? text : masked);
        if (!match) {
            continue;
        }
        if (field === 'host' && isInsideSpan(spans, match.index)) {
            continue;
        }
        const value = stripWrapping(match[1] ?? '');
        if (!value || (validate && !validate(value))) {
            continue;
        }
        fields[field] = value;
    }
    return fields;
}

export function extractMacAddresses(
    text: string,
    labeledMac: string | undefined
): string[] {
    const macs: string[] = [];
    const push = (value: string | null) => {
        if (value && !macs.includes(value)) {
            macs.push(value);
        }
    };
    push(normalizeStalkerMacAddress(labeledMac));
    for (const match of allMatches(SEPARATED_MAC_PATTERN, text)) {
        push(normalizeStalkerMacAddress(match[0]));
    }
    for (const match of allMatches(BARE_INFOMIR_MAC_PATTERN, text)) {
        push(normalizeStalkerMacAddress(match[0]));
    }
    return macs.slice(0, MAX_MACS);
}

/**
 * Turns a labeled server/host value into an http URL. A scheme-less host is
 * completed with `http://` and a separately labeled port — the one place a
 * value is assembled rather than found verbatim, and it lands in an editable
 * form field, never on the wire directly.
 */
export function labeledHostUrl(labeled: LabeledFields): string | undefined {
    const host = labeled.host;
    if (!host) {
        return undefined;
    }
    if (/^https?:\/\//i.test(host)) {
        return host;
    }
    if (!HOSTISH_PATTERN.test(host) || !host.includes('.')) {
        return undefined;
    }
    const portSuffix =
        host.includes(':') || !labeled.port ? '' : `:${labeled.port}`;
    return `http://${host}${portSuffix}`;
}

function urlSpans(
    text: string,
    urls: DetectedUrl[]
): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const url of urls) {
        let from = 0;
        for (;;) {
            const index = text.indexOf(url.raw, from);
            if (index === -1) {
                break;
            }
            spans.push([index, index + url.raw.length]);
            from = index + url.raw.length;
        }
    }
    return spans;
}

function maskSpans(text: string, spans: Array<[number, number]>): string {
    if (spans.length === 0) {
        return text;
    }
    const chars = text.split('');
    for (const [start, end] of spans) {
        for (let index = start; index < end; index += 1) {
            chars[index] = ' ';
        }
    }
    return chars.join('');
}

function isInsideSpan(
    spans: Array<[number, number]>,
    index: number
): boolean {
    return spans.some(([start, end]) => index > start && index < end);
}

function stripWrapping(value: string): string {
    return value.trim().replace(WRAPPING_CHARS, '').trim();
}
