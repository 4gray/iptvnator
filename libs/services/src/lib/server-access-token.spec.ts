import {
    clearServerAccessToken,
    readServerAccessToken,
    SERVER_ACCESS_TOKEN_STORAGE_KEY,
    serverAuthorizationHeaders,
    writeServerAccessToken,
} from './server-access-token';

describe('server access token', () => {
    afterEach(() => localStorage.clear());

    it('has no header without a token', () => {
        expect(readServerAccessToken()).toBeNull();
        expect(serverAuthorizationHeaders()).toEqual({});
    });

    it('stores a trimmed token and builds the bearer header', () => {
        writeServerAccessToken('  s3cret ');

        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe(
            's3cret'
        );
        expect(serverAuthorizationHeaders()).toEqual({
            Authorization: 'Bearer s3cret',
        });

        clearServerAccessToken();
        expect(readServerAccessToken()).toBeNull();
    });

    it('reports a token browser storage refuses', () => {
        const refuse = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('full', 'QuotaExceededError');
            });
        try {
            expect(writeServerAccessToken('s3cret')).toBe(false);
            expect(readServerAccessToken()).toBeNull();
        } finally {
            refuse.mockRestore();
        }
        expect(writeServerAccessToken('s3cret')).toBe(true);
    });
});
