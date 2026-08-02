/**
 * Wire encoding for the Stalker `cmd` query parameter.
 *
 * A real MAG/STB sends `cmd` unencoded: the portal's own client JS
 * concatenates raw `key=value` pairs, WebKit's URL layer escapes only the
 * characters a URL cannot carry (space, quotes, non-ASCII), and PHP's `$_GET`
 * then applies exactly one form-urldecode. The portal therefore sees the
 * stored cmd decoded **once** — pre-encoded sequences such as `%3A` arrive as
 * `:`, and a literal `+` arrives as a space.
 *
 * `encodeURIComponent` (the previous behavior) broke that contract for any
 * cmd already containing `%`: `%3A` went out as `%253A` and reached the
 * portal still encoded, so strict panels and the stock
 * `preg_match`-based `create_link` handlers saw a different string than a
 * real STB would send.
 *
 * This encoder reproduces the reference wire bytes instead:
 *
 * - `%` passes through untouched (never double-encoded);
 * - characters the WHATWG URL serializer keeps raw in a query stay raw
 *   (`/ : ? = + , @ $ [ ] ! * ( ) ~ - _ .`), so the bytes we emit survive
 *   `new URL(...)` unchanged;
 * - everything else is percent-encoded. That covers the characters that
 *   would restructure our request (`&`, `#`, and `;` for PHP setups with a
 *   `;` argument separator) — a malicious portal cannot smuggle extra query
 *   parameters through cmd — plus characters a URL cannot carry raw (space,
 *   quotes, control characters, non-ASCII). All of them decode back to the
 *   original byte on the server, so the portal-visible value is unaffected.
 */

const SAFE_CMD_CHAR = /^[A-Za-z0-9\-_.~!*()/:?@$,+=[\]%]$/;

const utf8Encoder = new TextEncoder();

/**
 * Percent-encode every UTF-8 byte of a character. Deliberately not
 * `encodeURIComponent`, whose unreserved set (e.g. `'`) overlaps characters
 * this encoder must escape because `new URL(...)` would re-encode them and
 * change the wire bytes behind our back.
 */
function percentEncodeChar(char: string): string {
    let encoded = '';
    for (const byte of utf8Encoder.encode(char)) {
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return encoded;
}

export function encodeStalkerCmdValue(value: string): string {
    let encoded = '';
    for (const char of value) {
        encoded += SAFE_CMD_CHAR.test(char) ? char : percentEncodeChar(char);
    }
    return encoded;
}
