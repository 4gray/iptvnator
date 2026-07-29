import { execFileSync } from 'node:child_process';
import { caseInsensitiveGlobPattern } from './title-token-glob';

/**
 * Case folding for the tokens SQLite cannot fold.
 *
 * The patterns are only worth anything if SQLite agrees with them, so the
 * behavioural cases below are asserted against a real `sqlite3` rather than
 * against a restatement of the builder's own logic.
 */

/** `true` when the running SQLite says `value GLOB pattern`. */
function sqliteGlob(value: string, pattern: string): boolean {
    const out = execFileSync(
        'sqlite3',
        [':memory:', `SELECT ${quote(value)} GLOB ${quote(pattern)};`],
        { encoding: 'utf8' }
    );
    return out.trim() === '1';
}

function quote(literal: string): string {
    return `'${literal.replace(/'/g, "''")}'`;
}

/**
 * The suite asserts against the sqlite3 CLI, which is present on macOS and on
 * the CI images but is not a declared dependency of this workspace.
 */
function hasSqlite(): boolean {
    try {
        execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const describeWithSqlite = hasSqlite() ? describe : describe.skip;

describe('caseInsensitiveGlobPattern', () => {
    it('builds a case class for each cased character', () => {
        expect(caseInsensitiveGlobPattern('Он')).toBe('*[Оо][нН]*');
    });

    it('leaves uncased characters alone', () => {
        expect(caseInsensitiveGlobPattern('7')).toBe('*7*');
    });

    it('covers a letter with two lowercase spellings', () => {
        // Greek Σ lowercases to σ, but a word-final sigma is written ς and is
        // just as much a lowercase of it. Going back down from the uppercase
        // form reaches the spelling the character in hand does not name.
        expect(caseInsensitiveGlobPattern('ς')).toBe('*[ςΣσ]*');
    });

    it('reaches the second spelling in one direction only', () => {
        // σ → Σ → σ never arrives at ς, so a request spelled with a medial
        // sigma does not match a stored final one. Left as is: ς is only ever
        // correct at the end of a word, which is exactly where the request's
        // own last character sits, so the pair that occurs in real titles is
        // the one above. Closing the other direction needs a fold table.
        expect(caseInsensitiveGlobPattern('σ')).toBe('*[σΣ]*');
    });

    it('refuses a token holding a GLOB metacharacter', () => {
        // SQLite GLOB has no escape character, so an unescaped `*` here would
        // silently become a wildcard and match every row in the table.
        expect(caseInsensitiveGlobPattern('о*')).toBeNull();
        expect(caseInsensitiveGlobPattern('[о')).toBeNull();
        expect(caseInsensitiveGlobPattern('о-н')).toBeNull();
    });

    it('refuses a case mapping that changes length', () => {
        // 'ß'.toUpperCase() is 'SS' — there is no single-character class that
        // means the same thing, and guessing one would be a wrong pattern
        // rather than an absent one.
        expect(caseInsensitiveGlobPattern('ß')).toBeNull();
    });

    it('refuses an empty token', () => {
        expect(caseInsensitiveGlobPattern('')).toBeNull();
    });
});

describeWithSqlite('caseInsensitiveGlobPattern against SQLite', () => {
    it('matches a Cyrillic title in any case', () => {
        const pattern = caseInsensitiveGlobPattern('Он') as string;

        // The bug: LOWER() is ASCII-only, so a request for "Он" never found a
        // stored "ОН" and the film was missing from the Sources chip.
        expect(sqliteGlob('Он', pattern)).toBe(true);
        expect(sqliteGlob('ОН', pattern)).toBe(true);
        expect(sqliteGlob('он (2017)', pattern)).toBe(true);
    });

    it('is exactly what SQLite cannot do on its own', () => {
        // Guards the premise the whole helper rests on: if a future SQLite
        // folded Cyrillic in LOWER(), this indirection would be dead weight.
        const out = execFileSync(
            'sqlite3',
            [':memory:', `SELECT LOWER('Он') = 'он';`],
            { encoding: 'utf8' }
        );
        expect(out.trim()).toBe('0');
    });

    it('still refuses a title that does not hold the token', () => {
        const pattern = caseInsensitiveGlobPattern('Он') as string;

        expect(sqliteGlob('Дюна', pattern)).toBe(false);
    });

    it('matches a Greek word written with either sigma', () => {
        const pattern = caseInsensitiveGlobPattern('ος') as string;

        expect(sqliteGlob('ος', pattern)).toBe(true);
        expect(sqliteGlob('ΟΣ', pattern)).toBe(true);
        // The spelling a class built from the request alone would miss.
        expect(sqliteGlob('οσ', pattern)).toBe(true);
    });

    it('finds an accented title from its folded ASCII token', () => {
        // The token has already had its own diacritics folded, so "ca" is what
        // a search for "Ça" arrives as. Without the accented forms this
        // direction fails while the reverse works, and whether two playlists
        // can see each other then depends on which one is open.
        const pattern = caseInsensitiveGlobPattern('ca', {
            foldDiacritics: true,
        }) as string;

        expect(sqliteGlob('Ça', pattern)).toBe(true);
        expect(sqliteGlob('ÇA', pattern)).toBe(true);
        expect(sqliteGlob('ca', pattern)).toBe(true);
        expect(sqliteGlob('Ca', pattern)).toBe(true);
    });

    it('reaches beyond Latin Extended-B for the fold', () => {
        // "Bố" (U+1ED1) is Vietnamese and normalizes to "bo" like any other
        // accented o. A range that stops at Latin Extended-B looks tidy and
        // leaves a whole language filtered out before confirmation.
        const pattern = caseInsensitiveGlobPattern('bo', {
            foldDiacritics: true,
        }) as string;

        expect(sqliteGlob('Bố', pattern)).toBe(true);
        expect(sqliteGlob('bồ', pattern)).toBe(true);
        expect(sqliteGlob('Bo', pattern)).toBe(true);
    });

    it('does not fold diacritics unless asked', () => {
        const pattern = caseInsensitiveGlobPattern('ca') as string;

        // The non-ASCII branch pairs the raw token with the folded one and
        // relies on that, so widening this by default would be a silent
        // behaviour change for every caller.
        expect(sqliteGlob('Ça', pattern)).toBe(false);
        expect(sqliteGlob('Ca', pattern)).toBe(true);
    });

    it('matches Greek and accented Latin in any case', () => {
        expect(
            sqliteGlob('ΟΙ', caseInsensitiveGlobPattern('οι') as string)
        ).toBe(true);
        expect(
            sqliteGlob('ÇA', caseInsensitiveGlobPattern('Ça') as string)
        ).toBe(true);
    });
});
