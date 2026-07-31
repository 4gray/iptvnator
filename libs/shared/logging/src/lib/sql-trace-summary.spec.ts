import { summarizeSqlStatementForTrace } from './sql-trace-summary';

describe('summarizeSqlStatementForTrace', () => {
    it.each([
        [
            'SELECT',
            `SELECT * FROM playlists WHERE username = 'trace-user-secret' AND password = 'trace-password-secret' AND token = 'trace-token-secret'`,
        ],
        [
            'INSERT',
            `INSERT INTO playlists (name) VALUES ('O''Brien-secret')`,
        ],
        [
            'UPDATE',
            `UPDATE playlists SET url = 'https://url-user-secret:url-password-secret@example.com/live?token=url-token-secret'`,
        ],
        [
            'DELETE',
            `DELETE FROM content WHERE id = 987654321 AND payload = X'7365637265742D626C6F62'`,
        ],
        [
            'SELECT',
            ` \n\tSeLeCt * FROM content WHERE rating = 12345.6789`,
        ],
        [
            'WITH',
            `WITH credentials AS (SELECT 'with-secret') SELECT * FROM credentials`,
        ],
    ])('returns only the %s statement type', (statementType, sql) => {
        const summary = summarizeSqlStatementForTrace(sql);
        const serialized = JSON.stringify(summary);

        expect(summary).toEqual({ statementType });
        expect(serialized).toBe(`{"statementType":"${statementType}"}`);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain(`O''Brien-secret`);
        expect(serialized).not.toContain('987654321');
        expect(serialized).not.toContain('7365637265742D626C6F62');
        expect(serialized).not.toContain('12345.6789');
        expect(serialized).not.toContain('length');
    });

    it.each([
        ` \n-- SELECT 'comment-secret'\nSELECT * FROM playlists`,
        `\t/* INSERT 'comment-secret' */ SELECT * FROM playlists`,
        `VACUUMINTO 'malicious-secret'`,
        `SELECTpassword FROM credentials`,
        `DO 'unrecognized-secret'`,
        `'; DROP TABLE playlists; -- malicious-secret`,
        '',
        undefined,
        null,
    ])('maps comments and unrecognized input to OTHER', (sql) => {
        expect(summarizeSqlStatementForTrace(sql)).toEqual({
            statementType: 'OTHER',
        });
    });
});
