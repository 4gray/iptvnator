import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { buildLoadPlaybackCommand } from './embedded-mpv-frame-copy-protocol';

describe('buildLoadPlaybackCommand', () => {
    const basePlayback: ResolvedPortalPlayback = {
        streamUrl: 'https://portal.example/ch/1234',
    } as ResolvedPortalPlayback;

    it('escapes commas inside header values for the mpv stringlist parser', () => {
        const command = buildLoadPlaybackCommand({
            ...basePlayback,
            headers: {
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
                Referer: 'https://portal.example/c/',
            },
        });

        const headerField = command
            .split('\t')
            .find((field) => field.startsWith('opt.http-header-fields='));

        expect(headerField).toBeDefined();
        // The comma inside the MAG user agent is mpv-escaped; the comma
        // separating the two header fields is not.
        expect(headerField).toContain('(KHTML\\, like Gecko) MAG250');
        expect(headerField).toContain(',Referer: https://portal.example/c/');
    });

    it('omits the header option when no headers are present', () => {
        const command = buildLoadPlaybackCommand(basePlayback);

        expect(command).not.toContain('opt.http-header-fields=');
    });
});
