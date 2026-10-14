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

/** A decoded path part and the raw segment it came from. */
interface PathPart {
    readonly text: string;
    readonly owner: number;
}

/**
 * Finds the Xtream account in a URL path (`/live/<user>/<password>/…`,
 * markers in any case or encoding). The path is read two ways and both
 * count: each raw segment decoded whole, so a slash encoded inside a user
 * name stays part of it (`/live/joe%2Fx/hunter2/…`), and the decoded path
 * split on every separator, so one segment cannot carry a whole account
 * (`live%2Fjoe%2Fhunter2%2F1.ts`). With `streamFollows`, the two parts
 * after a marker count only when another part follows them, as a stream
 * does; a log line redacts without it.
 */
export function findXtreamAccount(
    rawSegments: readonly string[],
    options: { streamFollows?: boolean } = {}
): XtreamAccountScan {
    const whole: PathPart[] = [];
    const split: PathPart[] = [];
    rawSegments.forEach((raw, owner) => {
        const decoded = decodeFully(raw);
        whole.push({ text: decoded, owner });
        for (const text of decoded.split('/')) {
            split.push({ text, owner });
        }
    });
    const segments = new Set<number>();
    const accounts: [string, string][] = [];
    const after = options.streamFollows ? 3 : 2;
    for (const parts of [whole, split]) {
        for (let index = 0; index + after < parts.length; index += 1) {
            if (
                XTREAM_CREDENTIAL_PATH_SEGMENTS.has(
                    parts[index].text.toLowerCase()
                )
            ) {
                const [user, password] = [parts[index + 1], parts[index + 2]];
                segments.add(user.owner).add(password.owner);
                accounts.push([user.text, password.text]);
            }
        }
    }
    return { segments, accounts };
}
