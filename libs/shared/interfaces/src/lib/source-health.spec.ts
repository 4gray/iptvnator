import {
    accountHealth,
    sourceHealthError,
    sourceHealthKey,
    sourceHealthType,
} from './source-health';

describe('source health evidence', () => {
    it.each(['inactive', 'disabled', 'banned', 'expired'])(
        'accepts explicit %s as a cleanup candidate',
        (status) => {
            expect(accountHealth(status).confirmedInactive).toBe(true);
        }
    );
    it.each([
        'Authorization failed.',
        'HTTP Error 403: Forbidden',
        'request timeout',
        'connection cooldown',
        'network error',
    ])('does not preselect %s', (message) => {
        expect(sourceHealthError(new Error(message)).confirmedInactive).toBe(
            false
        );
    });
    it('does not treat unknown account statuses as disabled', () => {
        expect(accountHealth('2').confirmedInactive).toBe(false);
        expect(accountHealth(undefined, undefined, true).state).toBe('active');
    });
    it('detects expiry only from a real timestamp', () => {
        expect(accountHealth('active', Date.now() / 1000 - 60).state).toBe(
            'expired'
        );
        expect(accountHealth('active').state).toBe('active');
    });
    it('excludes local files and text, keys by connection rather than title', () => {
        expect(
            sourceHealthType({ _id: 'x', filePath: '/tmp/test.m3u' })
        ).toBeNull();
        const p = {
            _id: 'a',
            url: 'https://example.test/list',
            userAgent: 'A',
        };
        expect(sourceHealthType(p)).toBe('m3u');
        expect(sourceHealthKey(p)).toBe(
            sourceHealthKey({ ...p, title: 'Renamed' })
        );
        expect(sourceHealthKey(p)).not.toBe(
            sourceHealthKey({ ...p, userAgent: 'B' })
        );
    });
});
