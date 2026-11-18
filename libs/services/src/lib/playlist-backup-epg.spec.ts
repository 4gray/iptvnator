import { epgSourceReferenceIdentity } from './playlist-backup-epg';

describe('epgSourceReferenceIdentity', () => {
    it.each([
        [
            ' https://EXAMPLE.test:443/guide.xml ',
            'https://example.test/guide.xml',
        ],
        ['https://EXAMPLE.test/guide.xml/', 'https://example.test/guide.xml/'],
        [' /example/Guide.xml ', '/example/Guide.xml'],
        ['https://[invalid/guide.xml', 'https://[invalid/guide.xml'],
    ])('matches the source reference %j as %j', (url, identity) => {
        expect(epgSourceReferenceIdentity(url)).toBe(identity);
    });
});
