import { MediaMetadataService } from './media-metadata.service';
import { MediaStreamMetadata } from 'shared-interfaces';

type MediaElectronStub = {
    probeMediaStreamMetadata: jest.Mock<
        Promise<MediaStreamMetadata>,
        [string, Record<string, string> | undefined]
    >;
};

describe('MediaMetadataService', () => {
    const testWindow = window as unknown as {
        electron?: Partial<MediaElectronStub>;
    };
    const originalElectron = testWindow.electron;

    beforeEach(() => {
        localStorage.clear();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    });

    afterEach(() => {
        testWindow.electron = originalElectron;
        localStorage.clear();
        jest.useRealTimers();
    });

    it('persists successful probe results without leaking the raw stream URL in the storage key', async () => {
        const metadata: MediaStreamMetadata = {
            available: true,
            qualityLabel: '2160p HEVC',
            height: 2160,
            audioLanguages: ['ITA'],
            audioCodecs: [],
            subtitleLanguages: ['ENG'],
            subtitleCodecs: [],
        };
        const electron = {
            probeMediaStreamMetadata: jest.fn().mockResolvedValue(metadata),
        };
        testWindow.electron = electron;

        const service = new MediaMetadataService();
        const request = {
            url: 'https://example.com/movie/user/password/100.mkv',
            headers: { 'User-Agent': 'test-agent' },
        };

        await expect(service.probe(request)).resolves.toEqual(metadata);
        const secondService = new MediaMetadataService();
        await expect(secondService.probe(request)).resolves.toEqual(metadata);

        expect(electron.probeMediaStreamMetadata).toHaveBeenCalledTimes(1);
        expect(localStorage.key(0)).not.toContain('password');
        expect(localStorage.key(0)).not.toContain('example.com');
    });

    it('expires cached unavailable results earlier than successful metadata', async () => {
        const unavailable: MediaStreamMetadata = {
            available: false,
            audioLanguages: [],
            audioCodecs: [],
            subtitleLanguages: [],
            subtitleCodecs: [],
            reason: 'temporary failure',
        };
        const available: MediaStreamMetadata = {
            available: true,
            qualityLabel: '1080p',
            height: 1080,
            audioLanguages: [],
            audioCodecs: [],
            subtitleLanguages: [],
            subtitleCodecs: [],
        };
        const electron = {
            probeMediaStreamMetadata: jest
                .fn()
                .mockResolvedValueOnce(unavailable)
                .mockResolvedValueOnce(available),
        };
        testWindow.electron = electron;

        const request = { url: 'https://example.com/movie/100.mp4' };
        const service = new MediaMetadataService();

        await expect(service.probe(request)).resolves.toEqual(unavailable);
        jest.setSystemTime(new Date('2026-05-14T19:00:00.000Z'));

        const secondService = new MediaMetadataService();
        await expect(secondService.probe(request)).resolves.toEqual(available);
        expect(electron.probeMediaStreamMetadata).toHaveBeenCalledTimes(2);
    });
});
