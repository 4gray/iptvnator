import {
    clearServerAccessToken,
    readServerAccessToken,
    SERVER_ACCESS_TOKEN_OWNER_KEY,
    SERVER_ACCESS_TOKEN_STORAGE_KEY,
    writeServerAccessToken,
} from './server-access-token';

describe('server access token', () => {
    afterEach(() => localStorage.clear());

    it('has no token until one is stored', () => {
        expect(readServerAccessToken()).toBeNull();
        expect(readServerAccessToken('i-1')).toBeNull();
    });

    it('stores a trimmed token for the instance it was given for', () => {
        writeServerAccessToken('  s3cret ', 'i-1');

        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe(
            's3cret'
        );
        expect(readServerAccessToken('i-1')).toBe('s3cret');
        expect(readServerAccessToken()).toBe('s3cret');

        clearServerAccessToken();
        expect(readServerAccessToken()).toBeNull();
        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_OWNER_KEY)).toBeNull();
    });

    it("never hands another instance's token out", () => {
        writeServerAccessToken('new-server', 'i-2');
        expect(readServerAccessToken('i-1')).toBeNull();

        // A token stored without its instance belongs to none.
        localStorage.removeItem(SERVER_ACCESS_TOKEN_OWNER_KEY);
        expect(readServerAccessToken('i-2')).toBeNull();
    });

    it('reports a token browser storage refuses', () => {
        const refuse = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('full', 'QuotaExceededError');
            });
        try {
            expect(writeServerAccessToken('s3cret', 'i-1')).toBe(false);
            expect(readServerAccessToken()).toBeNull();
        } finally {
            refuse.mockRestore();
        }
        expect(writeServerAccessToken('s3cret', 'i-1')).toBe(true);
    });
});
