import {
    playlistDisplayLabel,
    playlistNameHasCredentials,
} from './playlist-display-label.util';

describe('playlistDisplayLabel', () => {
    it('collapses a credential-bearing URL to its host', () => {
        expect(
            playlistDisplayLabel(
                'http://vipmax.site:8080/get.php?username=00%3A1A%3A79&password=5fd87ba4&type=m3u_plus'
            )
        ).toBe('vipmax.site:8080');
    });

    it('strips credentials typed outside the URL', () => {
        // The default :80 is dropped by URL normalization, which reads better
        // anyway; a non-default port is kept (see the case above).
        expect(
            playlistDisplayLabel('http://marveltv.info:80 usr== Tl24uy0xGi pas=== pNt9PQMmL2')
        ).toBe('marveltv.info');
    });

    it('keeps a name the user actually chose', () => {
        expect(playlistDisplayLabel('DE movies/kinder')).toBe(
            'DE movies/kinder'
        );
        expect(playlistDisplayLabel('cord-cutter')).toBe('cord-cutter');
    });

    it('removes hand-typed credentials from a non-URL name', () => {
        expect(
            playlistDisplayLabel('MyPortal Username: abc Password: s3cret')
        ).toBe('MyPortal');
    });

    it('never renders a password fragment', () => {
        const labels = [
            'http://x.tv:80/get.php?username=joe&password=hunter2',
            'Portal user==joe pass==hunter2',
            'http://62.182.83.108 USERNAME : 99558627 PASSWORD : uUhQQlcHjD',
        ].map((n) => playlistDisplayLabel(n));

        for (const label of labels) {
            expect(label).not.toMatch(/hunter2|uUhQQlcHjD|99558627/);
        }
    });

    it('truncates an over-long name', () => {
        const label = playlistDisplayLabel('a'.repeat(120));
        expect(label.length).toBeLessThanOrEqual(42);
        expect(label.endsWith('…')).toBe(true);
    });

    it('falls back when there is nothing to show', () => {
        expect(playlistDisplayLabel('', 'playlist-1')).toBe('playlist-1');
        expect(playlistDisplayLabel(null, 'playlist-1')).toBe('playlist-1');
        expect(playlistDisplayLabel(undefined)).toBe('');
    });

    it('does not return an empty label for a credentials-only name', () => {
        expect(playlistDisplayLabel('username=joe password=x')).toBe(
            'Playlist'
        );
    });
});

describe('playlistNameHasCredentials', () => {
    it('detects query-string credentials', () => {
        expect(
            playlistNameHasCredentials('http://x.tv/get.php?username=a&password=b')
        ).toBe(true);
    });

    it('detects hand-typed credentials', () => {
        expect(playlistNameHasCredentials('Portal usr== abc pas== def')).toBe(
            true
        );
    });

    it('is false for an ordinary name', () => {
        expect(playlistNameHasCredentials('cord-cutter')).toBe(false);
        expect(playlistNameHasCredentials('http://plain.tv:8080')).toBe(false);
    });
});
