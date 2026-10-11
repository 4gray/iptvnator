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
});
