import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { XtreamApiService } from './xtream-api.service';
import { XtreamFullEpgService } from './xtream-full-epg.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';
import { normalizeEpgName } from './epg-name-normalization';

describe('XtreamFullEpgService', () => {
    const original = window.electron;
    const getEpgMapping = jest.fn<
        Promise<{ epgChannelId: string } | null>,
        [string]
    >();
    const getFullEpg = jest.fn(async () => []);
    const getProgramsForChannel = jest.fn<
        Promise<EpgItem[]>,
        [string, number?]
    >(async () => []);
    const runtimeCapabilities = { supportsEpgMapping: true };
    const findChannelIdsByName = jest.fn<
        Promise<Record<string, string | null>>,
        [ReadonlyArray<string | null | undefined>]
    >();
    const credentials = {
        id: 'synthetic-portal',
        serverUrl: 'https://provider.example',
        username: 'sample',
        password: 'sample',
        userAgent: 'Synthetic Client',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        getEpgMapping.mockResolvedValue(null);
        getFullEpg.mockResolvedValue([]);
        getProgramsForChannel.mockResolvedValue([]);
        findChannelIdsByName.mockResolvedValue({});
        runtimeCapabilities.supportsEpgMapping = true;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { getEpgMapping },
        });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
                {
                    provide: SettingsStore,
                    useValue: { preferUploadedEpgOverXtream: () => true },
                },
                { provide: XtreamApiService, useValue: { getFullEpg } },
                {
                    provide: XtreamXmltvFallbackService,
                    useValue: {
                        getProgramsForChannel,
                        findChannelIdsByName,
                        getProgramsByName:
                            XtreamXmltvFallbackService.prototype[
                                'getProgramsByName'
                            ],
                        resolveCurrentEpg:
                            XtreamXmltvFallbackService.prototype
                                .resolveCurrentEpg,
                    },
                },
            ],
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: original,
        });
    });

    it('uses the playlist-scoped mapping with the existing source priority and provider credentials', async () => {
        getEpgMapping.mockResolvedValueOnce({
            epgChannelId: ' synthetic.mapped ',
        });
        const options = {
            sessionId: 'synthetic-guide-session',
            signal: new AbortController().signal,
        };
        await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            101,
            'synthetic.original',
            { ...options, archiveDays: 7 }
        );
        expect(getEpgMapping).toHaveBeenCalledWith(
            'xtream:synthetic-portal:101'
        );
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'synthetic.mapped',
            7
        );
        expect(getFullEpg).toHaveBeenCalledWith(
            expect.objectContaining({ userAgent: credentials.userAgent }),
            101,
            { ...options, suppressErrorLog: true }
        );
    });

    it('does not start a schedule lookup if the consumer leaves before the mapping returns', async () => {
        let finish!: (mapping: { epgChannelId: string }) => void;
        getEpgMapping.mockImplementation(
            () => new Promise((resolve) => (finish = resolve))
        );
        const controller = new AbortController();
        const result = TestBed.inject(XtreamFullEpgService).load(
            credentials,
            101,
            'synthetic.original',
            { signal: controller.signal }
        );
        controller.abort();
        finish({ epgChannelId: 'synthetic.mapped' });
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(getProgramsForChannel).not.toHaveBeenCalled();
        expect(getFullEpg).not.toHaveBeenCalled();
    });

    it('loads the full XMLTV schedule found through an alternate display name when the stream has no EPG ID', async () => {
        const schedule = [{ title: 'Full alias schedule' }] as EpgItem[];
        getFullEpg.mockResolvedValueOnce([]);
        findChannelIdsByName.mockResolvedValueOnce({
            [normalizeEpgName('Alias Channel')]: 'xmltv.alias',
        });
        getProgramsForChannel.mockImplementation(async (id) =>
            id === 'xmltv.alias' ? schedule : []
        );

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            102,
            null,
            { channelName: 'Alias Channel', archiveDays: 5 }
        );

        expect(result).toBe(schedule);
        expect(findChannelIdsByName).toHaveBeenCalledWith(['Alias Channel']);
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'xmltv.alias',
            5
        );
    });

    it('treats a provider EPG ID of NULL as missing and resolves the channel by name', async () => {
        const schedule = [{ title: 'Recovered schedule' }] as EpgItem[];
        getFullEpg.mockResolvedValueOnce([]);
        findChannelIdsByName.mockResolvedValueOnce({
            [normalizeEpgName('Null ID Channel')]: 'xmltv.null-alias',
        });
        getProgramsForChannel.mockImplementation(async (id) =>
            id === 'xmltv.null-alias' ? schedule : []
        );

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            103,
            ' NULL ',
            { channelName: 'Null ID Channel' }
        );

        expect(result).toBe(schedule);
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'xmltv.null-alias',
            0
        );
        expect(getProgramsForChannel).not.toHaveBeenCalledWith('NULL', 0);
    });

    it('uses name fallback after the provider ID and provider schedule return no programmes', async () => {
        const schedule = [
            { title: 'Provider ID fallback schedule' },
        ] as EpgItem[];
        getProgramsForChannel.mockImplementation(async (id) =>
            id === 'xmltv.resolved' ? schedule : []
        );
        findChannelIdsByName.mockResolvedValueOnce({
            [normalizeEpgName('Provider Mismatch')]: 'xmltv.resolved',
        });

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            104,
            'provider.id',
            { channelName: 'Provider Mismatch' }
        );

        expect(result).toBe(schedule);
        expect(getProgramsForChannel).toHaveBeenNthCalledWith(
            1,
            'provider.id',
            0
        );
        expect(getProgramsForChannel).toHaveBeenLastCalledWith(
            'xmltv.resolved',
            0
        );
    });

    it('keeps a working provider EPG ID ahead of name fallback', async () => {
        const schedule = [{ title: 'Provider ID schedule' }] as EpgItem[];
        getProgramsForChannel.mockResolvedValueOnce(schedule);

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            109,
            'provider.id',
            { channelName: 'Could Match Another Guide' }
        );

        expect(result).toBe(schedule);
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'provider.id',
            0
        );
        expect(findChannelIdsByName).not.toHaveBeenCalled();
    });

    it('keeps a manual mapping ahead of provider IDs and does not name-match an empty manual guide', async () => {
        getEpgMapping.mockResolvedValueOnce({ epgChannelId: 'manual.xmltv' });
        getProgramsForChannel.mockResolvedValueOnce([]);
        getFullEpg.mockResolvedValueOnce([]);

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            105,
            'provider.id',
            { channelName: 'Could Match Another Guide' }
        );

        expect(result).toEqual([]);
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'manual.xmltv',
            0
        );
        expect(findChannelIdsByName).not.toHaveBeenCalled();
    });

    it('loads only the deterministically selected ID when a name has multiple candidates', async () => {
        const schedule = [{ title: 'Chosen candidate schedule' }] as EpgItem[];
        findChannelIdsByName.mockResolvedValueOnce({
            [normalizeEpgName('Shared Alias')]: 'xmltv.chosen',
        });
        getProgramsForChannel.mockImplementation(async (id) =>
            id === 'xmltv.chosen' ? schedule : []
        );

        const result = await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            106,
            null,
            { channelName: 'Shared Alias' }
        );

        expect(result).toBe(schedule);
        expect(getProgramsForChannel).toHaveBeenCalledTimes(1);
        expect(getProgramsForChannel).toHaveBeenCalledWith(
            'xmltv.chosen',
            0
        );
    });

    it('returns no XMLTV schedule when the channel name has no match', async () => {
        getFullEpg.mockResolvedValueOnce([]);
        findChannelIdsByName.mockResolvedValueOnce({
            [normalizeEpgName('Unmapped Channel')]: null,
        });

        await expect(
            TestBed.inject(XtreamFullEpgService).load(
                credentials,
                107,
                null,
                { channelName: 'Unmapped Channel' }
            )
        ).resolves.toEqual([]);
        expect(getProgramsForChannel).not.toHaveBeenCalled();
    });

    it('does not return a late provider schedule after the channel request was aborted', async () => {
        let finish!: (items: never[]) => void;
        getFullEpg.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve))
        );
        const controller = new AbortController();
        const request = TestBed.inject(XtreamFullEpgService).load(
            credentials,
            108,
            null,
            { channelName: 'Previous Channel', signal: controller.signal }
        );
        await Promise.resolve();
        controller.abort();
        finish([]);

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(findChannelIdsByName).not.toHaveBeenCalled();
    });
});
