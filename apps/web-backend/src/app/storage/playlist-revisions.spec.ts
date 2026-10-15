import { PlaylistRevisions } from './playlist-revisions';

describe('PlaylistRevisions', () => {
    it('keeps an ETag until the playlist is written', () => {
        const revisions = new PlaylistRevisions('boot');

        expect(revisions.etag('a')).toBe('"boot.0.0"');
        expect(revisions.etag('a')).toBe('"boot.0.0"');
        expect(revisions.bump('a')).toBe('"boot.0.1"');
        expect(revisions.etag('a')).toBe('"boot.0.1"');
        expect(revisions.etag('b')).toBe('"boot.0.0"');
    });

    it('invalidates every ETag on reset', () => {
        const revisions = new PlaylistRevisions('boot');
        revisions.bump('a');

        revisions.reset();

        expect(revisions.etag('a')).toBe('"boot.1.0"');
        expect(revisions.etag('b')).toBe('"boot.1.0"');
    });

    it('uses a random boot id by default', () => {
        expect(new PlaylistRevisions().etag('a')).not.toBe(
            new PlaylistRevisions().etag('a')
        );
    });
});
