import { youtubeEmbedUrl } from './vod-details-adapters';

describe('youtubeEmbedUrl', () => {
    it('builds an embed URL from a plain video id (TMDB format)', () => {
        expect(youtubeEmbedUrl('zAGVQLHvwOY')).toBe(
            'https://www.youtube-nocookie.com/embed/zAGVQLHvwOY'
        );
    });

    it('extracts the id from full watch URLs', () => {
        expect(
            youtubeEmbedUrl('https://www.youtube.com/watch?v=zAGVQLHvwOY')
        ).toBe('https://www.youtube-nocookie.com/embed/zAGVQLHvwOY');
        expect(
            youtubeEmbedUrl('https://www.youtube.com/watch?feature=x&v=abc123def')
        ).toBe('https://www.youtube-nocookie.com/embed/abc123def');
    });

    it('extracts the id from youtu.be short links and embed URLs', () => {
        expect(youtubeEmbedUrl('https://youtu.be/zAGVQLHvwOY')).toBe(
            'https://www.youtube-nocookie.com/embed/zAGVQLHvwOY'
        );
        expect(
            youtubeEmbedUrl('https://www.youtube.com/embed/zAGVQLHvwOY')
        ).toBe('https://www.youtube-nocookie.com/embed/zAGVQLHvwOY');
    });

    it('returns null for empty or unusable values', () => {
        expect(youtubeEmbedUrl(undefined)).toBeNull();
        expect(youtubeEmbedUrl(null)).toBeNull();
        expect(youtubeEmbedUrl('')).toBeNull();
        expect(youtubeEmbedUrl('   ')).toBeNull();
        expect(youtubeEmbedUrl('not a video!!!')).toBeNull();
        expect(youtubeEmbedUrl('https://vimeo.com/12345')).toBeNull();
    });
});
