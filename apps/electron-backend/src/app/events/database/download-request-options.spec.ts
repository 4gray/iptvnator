import { createFileName } from './download-request-options';

describe('download media filenames', () => {
    it.each([
        'exe',
        'CMD',
        'bat',
        'ps1',
        'lnk',
        'url',
        'html',
        'js',
        'app',
        'desktop',
        'mp4.exe',
    ])('rejects the provider-controlled .%s extension', (extension) => {
        expect(() =>
            createFileName('Movie', `https://provider.test/movie.${extension}`)
        ).toThrow('Unsupported download media type');
    });

    it.each(['mp4', 'mkv', 'ts', 'webm', 'mp3', 'flac', 'm4v', 'avi'])(
        'keeps a supported .%s media extension',
        (extension) => {
            expect(
                createFileName(
                    'Movie',
                    `https://provider.test/movie.${extension}`
                )
            ).toBe(`Movie.${extension}`);
        }
    );

    it.each([
        'https://provider.test/stream/1',
        'https://provider.test/stream.php',
    ])('uses a media filename for provider endpoints: %s', (url) =>
        expect(createFileName('Movie', url)).toBe('Movie.mp4')
    );
});
