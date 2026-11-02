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
        'https://provider.test',
        'https://provider.test?token=synthetic',
        'http://127.0.0.1:8888',
        'http://127.0.0.1:8888?token=synthetic#playback',
        'http://[::1]:8888',
    ])('uses a media filename for provider endpoints: %s', (url) =>
        expect(createFileName('Movie', url)).toBe('Movie.mp4')
    );

    it.each([
        ['https://provider.test?extension=mkv', 'mkv'],
        ['http://127.0.0.1:8888?format=webm', 'webm'],
    ])(
        'preserves declared media formats on a root endpoint: %s',
        (url, extension) =>
            expect(createFileName('Movie', url)).toBe(`Movie.${extension}`)
    );
});
