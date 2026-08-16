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

// `|` ends a URL: it is not a legal URL character, but it IS the inline field
// delimiter of one-line handouts ("Server: http://host|User: alice"). Letting
// the span run through it would mask the very next label and lose that
// account entirely.
const URL_PATTERN = /https?:\/\/[^\s<>"'`|]+/gi;
const TRAILING_PUNCTUATION = /[),.;:!?\]»›]+$/;

/**
 * Strips sentence punctuation a URL picked up from prose ("see http://x/y.")
 * — unless doing so breaks the address itself. `]` is both a closing quote in
 * prose and the structural end of an IPv6 authority (`http://[2001:db8::1]`),
 * and only parsing can tell the two apart: the stripped form wins whenever it
 * still parses, otherwise the original stands. Values with no scheme parse
 * either way, so they keep the plain stripped form.
 */
function stripTrailingProsePunctuation(value: string): string {
    const stripped = value.replace(TRAILING_PUNCTUATION, '');
    if (stripped === value || parsesAsUrl(stripped) || !parsesAsUrl(value)) {
        return stripped;
    }
    return value;
}

function parsesAsUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}
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

// Both caps are DOM-safety guards against pathological pastes (a log file
// full of MAC-shaped hex would otherwise render thousands of cards), sized
// far beyond any real handout — reseller and scanner dumps top out around a
// couple dozen accounts. The assembler's candidate cap leaves headroom for
// both scanners together, so neither truncates real input before assembly.
const MAX_URLS = 16;
const MAX_MACS = 64;

interface FieldMatcher {
    field: keyof LabeledFields;
    pattern: RegExp;
    validate?: (value: string) => boolean;
}

/** A label must not continue a word ("sublogin" is not a login label). */
const LABEL_LOOKBEHIND = String.raw`(?<![\p{L}\p{N}_])`;

/**
 * What may stand between a label and its value. Reseller messages decorate
 * this freely — `USER➤ abc`, `PASS ► abc`, `Login → abc` — so besides plain
 * `:`/`=`/`>` any run of arrow/geometric/dingbat glyphs (U+2190–21FF,
 * U+25A0–25FF, U+2600–27BF, U+2B00–2BFF) counts. A dash counts only when it
 * stands alone between spaces: "PASS - abc" is a separator, "user-friendly"
 * is prose. Some symbol IS still required — a bare "login example" in prose
 * must keep failing to match.
 */
const LABEL_SEPARATOR = String.raw`(?:\s*(?:[:=>]|[←-⇿■-◿☀-➿⬀-⯿])+\s*|\s+[-–—]+\s+)`;

const DEFAULT_VALUE = String.raw`[^\s,;|]+`;

function labeledPattern(labels: string, value = DEFAULT_VALUE): RegExp {
    return new RegExp(
        `${LABEL_LOOKBEHIND}(?:${labels})${LABEL_SEPARATOR}(${value})`,
        'iu'
    );
}

const isHexIdentity = (value: string) => HEX_IDENTITY_PATTERN.test(value);

/**
 * Folds decorative Unicode "font" alphabets that NFKC deliberately leaves
 * alone — squared (🄰), negative circled (🅐), negative squared (🅰) and
 * regional-indicator (🇦) capitals, plus the dingbat circled digits (➀ ❶ ➌)
 * and ⓿ — back to the ASCII they depict. NFKC already handles the math
 * alphabets (`𝚄𝚂𝙴𝚁`) and plain circled letters (Ⓐ); these blocks carry no
 * compatibility decomposition because Unicode treats them as symbols, but in
 * a reseller message `🅟🅐🅢🅢➤` is just PASS in a costume. Callers run this
 * AFTER `normalize('NFKC')`, and the label matchers below then see plain
 * ASCII.
 */
export function foldDecorativeAlphabets(text: string): string {
    const chars = Array.from(text);
    let result = '';
    for (let index = 0; index < chars.length; ) {
        const code = chars[index].codePointAt(0) as number;
        if (isRegionalIndicator(code)) {
            // Regional indicators are ambiguous: a run of EXACTLY two is a
            // real flag emoji (🇳🇱) that must survive untouched — folding it
            // would glue "NL" onto whatever follows and break an adjacent
            // label's word boundary. Fancy-text words (🇺🇸🇪🇷, 🇺🇷🇱) are runs
            // of three or more, so only those fold to letters.
            let end = index;
            while (
                end < chars.length &&
                isRegionalIndicator(chars[end].codePointAt(0) as number)
            ) {
                end += 1;
            }
            const run = chars.slice(index, end);
            result +=
                run.length >= 3
                    ? run
                          .map((char) =>
                              String.fromCharCode(
                                  0x41 +
                                      ((char.codePointAt(0) as number) -
                                          REGIONAL_INDICATOR_A)
                              )
                          )
                          .join('')
                    : run.join('');
            index = end;
            continue;
        }
        result += foldDecorativeCodePoint(code) ?? chars[index];
        index += 1;
    }
    return result;
}

const REGIONAL_INDICATOR_A = 0x1f1e6;
const REGIONAL_INDICATOR_Z = 0x1f1ff;

function isRegionalIndicator(code: number): boolean {
    return code >= REGIONAL_INDICATOR_A && code <= REGIONAL_INDICATOR_Z;
}

const DECORATIVE_LATIN_RANGES: Array<[number, number]> = [
    [0x1f130, 0x1f149], // 🄰 squared A–Z
    [0x1f150, 0x1f169], // 🅐 negative circled A–Z
    [0x1f170, 0x1f189], // 🅰 negative squared A–Z
];

const DECORATIVE_DIGIT_RANGES: Array<[number, number]> = [
    [0x2776, 0x277e], // ❶ negative circled 1–9
    [0x2780, 0x2788], // ➀ circled sans-serif 1–9
    [0x278a, 0x2792], // ➊ negative circled sans-serif 1–9
];

function foldDecorativeCodePoint(code: number): string | null {
    for (const [start, end] of DECORATIVE_LATIN_RANGES) {
        if (code >= start && code <= end) {
            return String.fromCharCode(0x41 + (code - start));
        }
    }
    for (const [start, end] of DECORATIVE_DIGIT_RANGES) {
        if (code >= start && code <= end) {
            return String.fromCharCode(0x31 + (code - start));
        }
    }
    return code === 0x24ff ? '0' : null; // ⓿
}

// Order matters only for readability — each matcher targets its own field and
// the numbered variants ("device id 2") are structured so the unnumbered
// pattern cannot swallow them (its optional `1` never matches a literal `2`,
// and the required separator then fails on the digit).
//
// The label vocabulary is deliberately small (English + Russian) until a
// corpus of real provider messages justifies growing it. Callers hand this
// table NFKC-normalized text, which is what folds the decorative
// math-alphabet labels (`𝚄𝚂𝙴𝚁`, `𝙿𝙰𝚂𝚂`) into the plain ASCII matched here.
const FIELD_MATCHERS: FieldMatcher[] = [
    {
        field: 'deviceId2',
        pattern: labeledPattern(String.raw`device[\s_-]*id[\s_-]*2`),
        validate: isHexIdentity,
    },
    {
        field: 'deviceId1',
        pattern: labeledPattern(String.raw`device[\s_-]*id[\s_-]*1?`),
        validate: isHexIdentity,
    },
    {
        field: 'signature2',
        pattern: labeledPattern(String.raw`sig(?:nature)?[\s_-]*2`),
        validate: isHexIdentity,
    },
    {
        field: 'signature1',
        pattern: labeledPattern(String.raw`sig(?:nature)?[\s_-]*1?`),
        validate: isHexIdentity,
    },
    {
        field: 'serialNumber',
        // `s[\s._/-]?n` covers SN, S/N, S.N and the spaced "S N" handouts use.
        pattern: labeledPattern(
            String.raw`serial[\s_-]*(?:number|no)?|s[\s._/-]?n|серийный(?:[\s_-]*номер)?`
        ),
        validate: (value) => value.length <= 64,
    },
    {
        field: 'serialNumber',
        // Separator-less handout ("SN 38415545307A3"): allowed only because
        // the hex-shaped value cannot be mistaken for prose.
        pattern: new RegExp(
            LABEL_LOOKBEHIND +
                String.raw`(?:serial|s[\s._/-]?n)\s+([0-9A-Fa-f]{8,64})\b`,
            'iu'
        ),
    },
    {
        field: 'macAddress',
        // Turkish panels label it "MAC ADRESİ" — the trailing İ/ı/i is listed
        // in a class because JS case-insensitive matching does not fold the
        // Turkish dotted/dotless I to ASCII `i`.
        pattern: labeledPattern(
            String.raw`mac(?:[\s_-]*(?:address|adres[iİıI]?))?|мак(?:[\s_-]*адрес)?`,
            String.raw`[0-9A-Fa-f:. -]{12,23}`
        ),
        validate: (value) => normalizeStalkerMacAddress(value) !== null,
    },
    {
        field: 'username',
        pattern: labeledPattern(
            String.raw`user[\s_-]*name|login|user|логин|пользователь`
        ),
    },
    {
        field: 'password',
        // "ADULT PASS" / "PARENTAL PASS" is the parental-control PIN, not the
        // account password — the variable-length lookbehinds skip those
        // occurrences and let the engine find an unqualified PASS elsewhere.
        pattern: new RegExp(
            `${LABEL_LOOKBEHIND}(?<!adult[\\s_-]{0,4})(?<!parent(?:al)?[\\s_-]{0,4})` +
                String.raw`(?:pass[\s_-]*word|pass|pwd|пароль)` +
                `${LABEL_SEPARATOR}(${DEFAULT_VALUE})`,
            'iu'
        ),
    },
    {
        field: 'host',
        pattern: labeledPattern(
            String.raw`(?:server|portal|host|dns|url|сервер|портал|хост|адрес)(?:[\s_-]*(?:url|address|адрес))?`
        ),
    },
    {
        field: 'port',
        pattern: labeledPattern(String.raw`port|порт`, String.raw`\d{2,5}\b`),
    },
];

/**
 * Fresh stateful matcher for a module-level global pattern, so `lastIndex`
 * never leaks between calls. Callers drive it lazily with `exec` and stop at
 * their cap — detection runs on every keystroke, and materializing every
 * match of a pathological paste up front would defeat the caps' purpose.
 * (Also avoids `String.prototype.matchAll`, which the web build's TS lib
 * target predates.)
 */
function freshMatcher(pattern: RegExp): RegExp {
    return new RegExp(pattern.source, pattern.flags);
}

export function extractUrls(text: string): DetectedUrl[] {
    const detected: DetectedUrl[] = [];
    const seen = new Set<string>();
    const matcher = freshMatcher(URL_PATTERN);
    let match: RegExpExecArray | null;
    while (
        detected.length < MAX_URLS &&
        (match = matcher.exec(text)) !== null
    ) {
        const raw = stripTrailingProsePunctuation(match[0]);
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

/**
 * The "both device IDs" marker: 1 and 2 joined by any symbol run ("1&2",
 * "1/2", "1💥2" — superscript ¹² are already folded to 1/2 by NFKC) or by
 * plain whitespace. Bare "12" stays a number, not a marker.
 */
const DUAL_MARKER = String.raw`1(?:\s*[^\p{L}\p{N}\s]+\s*|\s+)2`;

/**
 * "DEVICE ID=> 1&2 <hex>" — the marker may sit before or after the
 * separator, and the separator itself may be plain whitespace ("DeviceID
 * 1💥2 <hex>"), which is safe here only because the 16–64-hex value shape
 * cannot be prose.
 */
const DUAL_DEVICE_ID_PATTERN = new RegExp(
    LABEL_LOOKBEHIND +
        String.raw`device[\s_-]*ids?` +
        `(?:[\\s_-]*${DUAL_MARKER}(?:${LABEL_SEPARATOR}|\\s+)|(?:${LABEL_SEPARATOR}|\\s+)${DUAL_MARKER}\\s+)` +
        String.raw`([0-9A-Fa-f]{16,64})\b`,
    'iu'
);

export function extractLabeledFields(text: string): LabeledFields {
    // Query strings ARE label-shaped (`?username=u&password=p`), so labeled
    // extraction must never look inside a URL: credentials that ride in a
    // query are mined by `extractXtreamCredentialsFromUrl` with proper URL
    // decoding, and reading them as plain labels would truncate at `&`. Every
    // matcher therefore runs against a copy with URL spans blanked out — with
    // one exception: the host/server label legitimately points AT a URL
    // ("Portal: http://…"), so it reads the raw text, accepting only matches
    // whose label starts outside every URL span (`&url=…` inside a query
    // stays rejected).
    const spans = urlSpans(text);
    const masked = maskSpans(text, spans);
    const fields: LabeledFields = {};
    // "DEVICE ID=> 1&2 <hex>" (or "DEVICE ID 1&2: <hex>") hands one value to
    // both slots; the per-field matchers below cannot express that, and their
    // hex validation would otherwise discard the line entirely.
    const dual = DUAL_DEVICE_ID_PATTERN.exec(masked);
    if (dual) {
        fields.deviceId1 = dual[1];
        fields.deviceId2 = dual[1];
    }
    for (const { field, pattern, validate } of FIELD_MATCHERS) {
        if (fields[field] !== undefined) {
            continue;
        }
        // The host label is the one matcher that reads the RAW text, because
        // it legitimately points at a URL ("Portal: http://…"). That means it
        // also meets host-shaped query keys inside unrelated links
        // (`…/setup?url=guide`), so it keeps scanning past those rather than
        // giving up — a real `Server:` line further down must still win.
        const match =
            field === 'host'
                ? firstMatchOutsideSpans(pattern, text, spans)
                : pattern.exec(masked);
        if (!match) {
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
    for (const pattern of [SEPARATED_MAC_PATTERN, BARE_INFOMIR_MAC_PATTERN]) {
        const matcher = freshMatcher(pattern);
        let match: RegExpExecArray | null;
        while (
            macs.length < MAX_MACS &&
            (match = matcher.exec(text)) !== null
        ) {
            push(normalizeStalkerMacAddress(match[0]));
        }
    }
    return macs;
}

/**
 * Turns a labeled server/host value into an http URL. A scheme-less host is
 * completed with `http://` and a separately labeled port — the one place a
 * value is assembled rather than found verbatim, and it lands in an editable
 * form field, never on the wire directly.
 */
export function labeledHostUrl(labeled: LabeledFields): string | undefined {
    // Same sentence-punctuation cleanup the URL scanner applies: a labeled
    // value takes precedence over the scanned one, so leaving `Server:
    // http://host!` uncleaned here would hand the forms a hostname DNS can
    // never resolve while the sanitized scanned URL sat right beside it.
    const host = labeled.host
        ? stripTrailingProsePunctuation(labeled.host)
        : undefined;
    if (!host) {
        return undefined;
    }
    if (/^https?:\/\//i.test(host)) {
        // Panels often hand out "Portal: http://host" and "Port: 8080" as two
        // separate lines — a separately labeled port completes a port-less URL.
        if (labeled.port) {
            try {
                const url = new URL(host);
                if (!url.port) {
                    url.port = labeled.port;
                    return url.toString();
                }
            } catch {
                return host;
            }
        }
        return host;
    }
    if (!HOSTISH_PATTERN.test(host) || !host.includes('.')) {
        return undefined;
    }
    const portSuffix =
        host.includes(':') || !labeled.port ? '' : `:${labeled.port}`;
    return `http://${host}${portSuffix}`;
}

/**
 * Spans of EVERY URL-shaped run in the text — deliberately not derived from
 * the capped `extractUrls` result. A URL past that cap still carries a query
 * that is label-shaped (`?username=…&password=…`), and an unmasked one would
 * feed the label matchers credentials belonging to a source that never became
 * a candidate. Spans are cheap index pairs, so the cap that bounds candidate
 * assembly does not apply here.
 */
function urlSpans(text: string): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    const matcher = freshMatcher(URL_PATTERN);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
        spans.push([match.index, match.index + match[0].length]);
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

/**
 * First match of `pattern` whose label does not start inside a URL span.
 *
 * Both sequences are produced left to right and the spans never overlap, so
 * a single forward cursor is enough — rescanning the span list per match
 * would be quadratic on a paste full of host-shaped query keys, and this
 * runs synchronously on every keystroke.
 */
function firstMatchOutsideSpans(
    pattern: RegExp,
    text: string,
    spans: Array<[number, number]>
): RegExpExecArray | null {
    const matcher = freshMatcher(
        pattern.flags.includes('g')
            ? pattern
            : new RegExp(pattern.source, `${pattern.flags}g`)
    );
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
        while (cursor < spans.length && spans[cursor][1] <= match.index) {
            cursor += 1;
        }
        const span = spans[cursor];
        if (!span || !(match.index > span[0] && match.index < span[1])) {
            return match;
        }
        if (match[0] === '') {
            matcher.lastIndex += 1;
        }
    }
    return null;
}

function stripWrapping(value: string): string {
    const trimmed = value.trim();
    const stripped = trimmed.replace(WRAPPING_CHARS, '').trim();
    // Same hazard as the prose-punctuation cleanup: `]` closes both a bracket
    // quote and an IPv6 authority, so a strip that breaks the address loses.
    if (stripped === trimmed || parsesAsUrl(stripped) || !parsesAsUrl(trimmed)) {
        return stripped;
    }
    return trimmed;
}
