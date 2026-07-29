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
    it('builds a two-case class for each cased character', () => {
        expect(caseInsensitiveGlobPattern('Он')).toBe('*[оО][нН]*');
    });

    it('leaves uncased characters alone', () => {
        expect(caseInsensitiveGlobPattern('7')).toBe('*7*');
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

    it('matches Greek and accented Latin in any case', () => {
        expect(
            sqliteGlob('ΟΙ', caseInsensitiveGlobPattern('οι') as string)
        ).toBe(true);
        expect(
            sqliteGlob('ÇA', caseInsensitiveGlobPattern('Ça') as string)
        ).toBe(true);
    });
});
