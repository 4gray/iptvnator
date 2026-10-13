/**
 * How a URL's parts read once decoded, for every check that compares them
 * by name: the log redactor and the on-screen URL cleanup share these, so a
 * spelling one of them understands the other does too.
 */

const XTREAM_CREDENTIAL_PATH_SEGMENTS: ReadonlySet<string> = new Set([
    'live',
    'movie',
    'series',
    'timeshift',
]);
/** Percent-decoding rounds before a name is compared. */
const MAX_DECODE_ROUNDS = 4;

/**
 * A name as it reads once every percent-encoding layer is undone, within a
 * bound: `%2570assword` is `password`, and `%256Cive` is `live`. Every
 * check that compares a key or marker by name must see this form, or one
 * more encoding layer slips a secret past it. A malformed escape (`100%`)
 * ends the decoding as written.
 */
export function decodeFully(value: string): string {
    let current = value;
    for (
        let round = 0;
        round < MAX_DECODE_ROUNDS && current.includes('%');
        round += 1
    ) {
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            break;
        }
        if (next === current) {
            break;
        }
        current = next;
    }
    return current;
}

export interface XtreamAccountScan {
    /** Indexes of the raw path segments that hold an account part. */
    readonly segments: ReadonlySet<number>;
    /** Each account found, as `[user, password]`. */
    readonly accounts: readonly (readonly [string, string])[];
}

/**
 * Finds the Xtream account in a URL path (`/live/<user>/<password>/…`,
 * markers in any case or encoding). The path is read decoded: separators
 * encoded into one segment (`live%2Fjoe%2Fhunter2%2F1.ts`) still separate
 * its parts, so an account cannot hide inside one segment. With
 * `streamFollows`, the two parts after a marker count only when another
 * part follows them, as a stream does; a log line redacts without it.
 */
export function findXtreamAccount(
    rawSegments: readonly string[],
    options: { streamFollows?: boolean } = {}
): XtreamAccountScan {
    const parts: string[] = [];
    const owners: number[] = [];
    rawSegments.forEach((raw, owner) => {
        for (const part of decodeFully(raw).split('/')) {
            parts.push(part);
            owners.push(owner);
        }
    });
    const segments = new Set<number>();
    const accounts: [string, string][] = [];
    const after = options.streamFollows ? 3 : 2;
    for (let index = 0; index + after < parts.length; index += 1) {
        if (XTREAM_CREDENTIAL_PATH_SEGMENTS.has(parts[index].toLowerCase())) {
            segments.add(owners[index + 1]);
            segments.add(owners[index + 2]);
            accounts.push([parts[index + 1], parts[index + 2]]);
        }
    }
    return { segments, accounts };
}
