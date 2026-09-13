import { formatEpgImportDisplayUrl } from './epg-import-display-url';

describe('formatEpgImportDisplayUrl', () => {
    it('separates the host from the file name', () => {
        expect(
            formatEpgImportDisplayUrl('http://epg.it999.ru/edem.xml.gz')
        ).toBe('epg.it999.ru/edem.xml.gz');
    });

    it('collapses intermediate path segments', () => {
        expect(
            formatEpgImportDisplayUrl(
                'https://iptvx.one/static/epg/epg_lite.xml.gz?token=secret'
            )
        ).toBe('iptvx.one/…/epg_lite.xml.gz');
    });

    it('decodes a percent-encoded remote file name', () => {
        expect(
            formatEpgImportDisplayUrl('https://example.org/guide%20v2.xml')
        ).toBe('example.org/guide v2.xml');
        expect(
            formatEpgImportDisplayUrl('https://example.org/epg/guide%ZZ.xml')
        ).toBe('example.org/…/guide%ZZ.xml');
    });

    it('falls back to the host when the path has no file name', () => {
        expect(formatEpgImportDisplayUrl('https://example.org/')).toBe(
            'example.org'
        );
        expect(formatEpgImportDisplayUrl('https://example.org')).toBe(
            'example.org'
        );
    });

    it('shows the file name of a local file URL or path', () => {
        expect(
            formatEpgImportDisplayUrl('file:///home/user/epg/guide%20v2.xml.gz')
        ).toBe('…/guide v2.xml.gz');
        expect(formatEpgImportDisplayUrl('/home/user/epg/guide.xml')).toBe(
            '…/guide.xml'
        );
        expect(formatEpgImportDisplayUrl('C:\\epg\\guide.xml.gz')).toBe(
            '…/guide.xml.gz'
        );
    });

    it('truncates unparsable values instead of throwing', () => {
        const long = 'x'.repeat(60);
        expect(formatEpgImportDisplayUrl(long)).toBe(`${'x'.repeat(40)}…`);
        expect(formatEpgImportDisplayUrl('short')).toBe('short');
    });
});
