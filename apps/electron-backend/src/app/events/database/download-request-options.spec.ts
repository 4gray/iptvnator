import { createFileName, sanitizeFilename } from './download-request-options';

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

describe('download filename stems', () => {
    const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

    it('keeps an ordinary title unchanged', () => {
        expect(sanitizeFilename('  Movie: Part 2 / Cut?  ')).toBe(
            'Movie_ Part 2 _ Cut_'
        );
    });

    it('caps a long multi-byte title in bytes without splitting a character', () => {
        const name = createFileName(
            '\u6f22'.repeat(120) + '\u{1F525}'.repeat(10),
            'http://localhost/movie/1.mp4'
        );
        expect(bytes(`${name} (9999).part`)).toBeLessThanOrEqual(255);
        expect(name).toMatch(/^\u6f22+\.mp4$/u);
        expect(bytes(sanitizeFilename('\u{1F525}'.repeat(80)))).toBe(200);
    });

    it('replaces control characters a filesystem refuses', () => {
        expect(sanitizeFilename('Show\nName\tS01\u0000\u007f')).toBe(
            'Show_Name_S01__'
        );
    });

    it.each([
        'CON',
        'nul',
        'Com1',
        'LPT9',
        'com0',
        'COM\u00b9',
        'lpt\u00b2',
        'LPT\u00b3.x',
        'aux.part one',
        'PRN ',
    ])('never yields the Windows device name %j', (title) => {
        expect(sanitizeFilename(title).startsWith('_')).toBe(true);
    });

    it.each(['Console', 'Common', 'LPT10', 'Nullish'])(
        'leaves a title that only starts like a device name: %s',
        (title) => {
            expect(sanitizeFilename(title)).toBe(title);
        }
    );

    it('falls back to a name for a title with nothing usable', () => {
        expect(sanitizeFilename('   ')).toBe('download');
        expect(createFileName('', 'http://localhost/movie/1.mkv')).toBe(
            'download.mkv'
        );
    });
});
