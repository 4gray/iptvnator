import { validateCatchupDownload } from './download-catchup';

describe('catch-up download validation', () => {
    const now = 1788800000;
    const metadata = {
        channelName: 'News',
        startTimestamp: now - 7200,
        stopTimestamp: now - 3600,
        expiresAt: now + 86400,
    };
    it('accepts a completed programme inside its archive window', () => {
        expect(
            validateCatchupDownload(
                metadata,
                'https://host/timeshift/u/p/60/date/1.ts',
                now
            )
        ).toEqual(metadata);
    });
    it.each([
        { ...metadata, stopTimestamp: now + 1 },
        { ...metadata, stopTimestamp: metadata.startTimestamp },
        { ...metadata, startTimestamp: NaN },
        { ...metadata, expiresAt: now },
        null,
    ])('refuses incomplete, invalid or expired programmes', (data) => {
        expect(() =>
            validateCatchupDownload(data, 'https://host/1.ts', now)
        ).toThrow();
    });
    it.each([
        'https://host/archive.m3u8',
        'https://host/timeshift.php?extension=m3u8',
    ])('refuses HLS URLs', (url) => {
        expect(() => validateCatchupDownload(metadata, url, now)).toThrow(/TS/);
    });
});
