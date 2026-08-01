/**
 * mpv's `http-header-fields` option is a comma-separated list
 * (OPT_STRINGLIST). Header values that themselves contain commas — e.g. the
 * Stalker MAG250 user agent "...(KHTML, like Gecko) MAG250" — must be escaped
 * or mpv splits them into bogus fields and the server rejects the request
 * (HTTP 400). mpv strips the backslash and keeps the comma inside the value.
 * Mirrors the escaping of the native embedded-mpv addon (PR #1321).
 */
export function escapeMpvStringListValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

/** Join `Name: value` header fields into one mpv stringlist option value. */
export function joinMpvHeaderFields(fields: readonly string[]): string {
    return fields.map(escapeMpvStringListValue).join(',');
}
