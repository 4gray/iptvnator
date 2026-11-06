import {
    readServerStorageConfig,
    serverStorageConfigProblem,
} from './storage-config';

describe('readServerStorageConfig', () => {
    it('keeps storage off and the API open by default', () => {
        expect(readServerStorageConfig({})).toEqual({
            enabled: false,
            accessToken: null,
            maxDocumentBytes: 64 * 1024 * 1024,
        });
    });

    it('enables storage only for IPTVNATOR_STORAGE=server', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: ' Server ' }).enabled
        ).toBe(true);
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: 'none' }).enabled
        ).toBe(false);
        expect(
            readServerStorageConfig({ IPTVNATOR_STORAGE: '1' }).enabled
        ).toBe(false);
    });

    it('reads a trimmed access token and ignores a blank one', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_ACCESS_TOKEN: ' s3cret ' })
                .accessToken
        ).toBe('s3cret');
        expect(
            readServerStorageConfig({ IPTVNATOR_ACCESS_TOKEN: '  ' })
                .accessToken
        ).toBeNull();
    });

    it('reads a positive document limit in megabytes', () => {
        expect(
            readServerStorageConfig({ IPTVNATOR_MAX_DOCUMENT_MB: '8' })
                .maxDocumentBytes
        ).toBe(8 * 1024 * 1024);
        expect(
            readServerStorageConfig({ IPTVNATOR_MAX_DOCUMENT_MB: '-1' })
                .maxDocumentBytes
        ).toBe(64 * 1024 * 1024);
    });

    it('refuses an access token without server storage', () => {
        const problem = (env: Record<string, string>) =>
            serverStorageConfigProblem(readServerStorageConfig(env));

        expect(problem({ IPTVNATOR_ACCESS_TOKEN: 's3cret' })).toContain(
            'IPTVNATOR_STORAGE=server'
        );
        expect(
            problem({
                IPTVNATOR_ACCESS_TOKEN: 's3cret',
                IPTVNATOR_STORAGE: 'server',
            })
        ).toBeNull();
        expect(problem({})).toBeNull();
    });
});
