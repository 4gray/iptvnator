import { compactSqlForTrace, summarizeForTrace } from './debug-trace';

describe('debug trace redaction', () => {
    it('redacts DVR credentials and trusted filesystem paths', () => {
        const summary = summarizeForTrace({
            id: 'recording-1',
            streamUrl: 'https://user:password@example.com/live?token=secret',
            requestHeaders: { Authorization: 'Bearer secret' },
            recordingDirectory: '/Users/test/Movies',
            filePath: '/Users/test/Movies/private.ts',
        });

        expect(summary).toEqual({
            id: 'recording-1',
            streamUrl: '[REDACTED]',
            requestHeaders: '[REDACTED]',
            recordingDirectory: '[REDACTED]',
            filePath: '[REDACTED]',
        });
    });

    it('redacts header containers independent of casing and separators', () => {
        expect(
            summarizeForTrace({
                headers: { Cookie: 'session=secret' },
                request_headers: { Authorization: 'secret' },
            })
        ).toEqual({
            headers: '[REDACTED]',
            request_headers: '[REDACTED]',
        });
    });

    it('redacts expanded SQL string and blob literals', () => {
        const sql = compactSqlForTrace(
            "UPDATE recordings SET stream_url = 'https://user:secret@example.com/live', request_headers = '{\"Authorization\":\"Bearer secret\"}', output = X'736563726574' WHERE id = 'recording-1'"
        );

        expect(sql).toContain('UPDATE recordings SET stream_url = ?');
        expect(sql).not.toContain('user:secret');
        expect(sql).not.toContain('Bearer secret');
        expect(sql).not.toContain('736563726574');
        expect(sql).not.toContain('recording-1');
    });
});
