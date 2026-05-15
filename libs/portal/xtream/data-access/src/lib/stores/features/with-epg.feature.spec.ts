import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { DataService, SettingsStore } from '@iptvnator/services';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { XtreamApiService } from '../../services/xtream-api.service';
import { XtreamXmltvFallbackService } from '../../services/xtream-xmltv-fallback.service';
import { withEpg } from './with-epg.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    id: 'playlist-1',
    serverUrl: 'http://demo.example',
    username: 'demo',
    password: 'secret',
};

function buildProgram(
    title: string,
    startTimestamp: number,
    stopTimestamp: number
): EpgItem {
    return {
        id: title,
        epg_id: title,
        title,
        description: `${title} description`,
        lang: 'en',
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        end: new Date(stopTimestamp * 1000).toISOString(),
        channel_id: 'channel-101',
        start_timestamp: String(startTimestamp),
        stop_timestamp: String(stopTimestamp),
    };
}

interface TestStoreSetup {
    selectedItem: { xtream_id: number; epg_channel_id?: string | null };
    preferUploaded?: boolean;
}

function configureStore(setup: TestStoreSetup) {
    const TestEpgStore = signalStore(
        withState({
            currentPlaylist: PLAYLIST,
            selectedItem: setup.selectedItem,
        }),
        withEpg()
    );

    const xtreamApiService = {
        getFullEpg: jest.fn<Promise<EpgItem[]>, unknown[]>(),
        getShortEpg: jest.fn<Promise<EpgItem[]>, unknown[]>(),
    };

    const fallbackService = {
        getProgramsForChannel: jest.fn<Promise<EpgItem[]>, unknown[]>(),
        resolveCurrentEpg:
            XtreamXmltvFallbackService.prototype.resolveCurrentEpg,
    };

    const settingsStore = {
        preferUploadedEpgOverXtream: jest.fn(
            () => setup.preferUploaded ?? false
        ),
    };

    TestBed.configureTestingModule({
        providers: [
            TestEpgStore,
            { provide: DataService, useValue: { isElectron: true } },
            { provide: XtreamApiService, useValue: xtreamApiService },
            {
                provide: XtreamXmltvFallbackService,
                useValue: fallbackService,
            },
            { provide: SettingsStore, useValue: settingsStore },
        ],
    });

    const store = TestBed.inject(TestEpgStore);
    return { store, xtreamApiService, fallbackService, settingsStore };
}

describe('withEpg', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('loads the full electron epg and derives the current program from timestamps', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            selectedItem: { xtream_id: 101 },
        });
        const now = Math.floor(Date.now() / 1000);
        const programs = [
            buildProgram('Past Show', now - 7200, now - 3600),
            buildProgram('Current Show', now - 300, now + 1800),
            buildProgram('Next Show', now + 1800, now + 3600),
        ];
        xtreamApiService.getFullEpg.mockResolvedValue(programs);

        const result = await store.loadEpg();

        expect(xtreamApiService.getFullEpg).toHaveBeenCalledWith(
            {
                serverUrl: 'http://demo.example',
                username: 'demo',
                password: 'secret',
            },
            101,
            { suppressErrorLog: true }
        );
        expect(fallbackService.getProgramsForChannel).not.toHaveBeenCalled();
        expect(result).toEqual(programs);
        expect(store.epgItems()).toEqual(programs);
        expect(store.currentEpgItem()).toEqual(programs[1]);
        expect(store.isLoadingEpg()).toBe(false);
    });

    it('falls back to XMLTV when Xtream returns empty and epg_channel_id is set', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            selectedItem: { xtream_id: 101, epg_channel_id: 'rtl.de' },
        });
        xtreamApiService.getFullEpg.mockResolvedValue([]);
        const now = Math.floor(Date.now() / 1000);
        const xmltvPrograms = [
            buildProgram('XMLTV Show', now - 600, now + 600),
        ];
        fallbackService.getProgramsForChannel.mockResolvedValue(xmltvPrograms);

        const result = await store.loadEpg();

        expect(fallbackService.getProgramsForChannel).toHaveBeenCalledWith(
            'rtl.de'
        );
        expect(result).toEqual(xmltvPrograms);
        expect(store.epgItems()).toEqual(xmltvPrograms);
    });

    it('returns empty when Xtream is empty and epg_channel_id is missing', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            selectedItem: { xtream_id: 101, epg_channel_id: null },
        });
        xtreamApiService.getFullEpg.mockResolvedValue([]);

        const result = await store.loadEpg();

        expect(result).toEqual([]);
        expect(fallbackService.getProgramsForChannel).not.toHaveBeenCalled();
    });

    it('queries XMLTV first when preferUploadedEpgOverXtream is on', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            selectedItem: { xtream_id: 101, epg_channel_id: 'rtl.de' },
            preferUploaded: true,
        });
        const now = Math.floor(Date.now() / 1000);
        const xmltvPrograms = [
            buildProgram('Curated Show', now - 600, now + 600),
        ];
        fallbackService.getProgramsForChannel.mockResolvedValue(xmltvPrograms);

        const result = await store.loadEpg();

        expect(fallbackService.getProgramsForChannel).toHaveBeenCalledWith(
            'rtl.de'
        );
        expect(xtreamApiService.getFullEpg).not.toHaveBeenCalled();
        expect(result).toEqual(xmltvPrograms);
    });

    it('falls back to Xtream when preferUploadedEpgOverXtream is on but XMLTV is empty', async () => {
        const { store, xtreamApiService, fallbackService } = configureStore({
            selectedItem: { xtream_id: 101, epg_channel_id: 'rtl.de' },
            preferUploaded: true,
        });
        fallbackService.getProgramsForChannel.mockResolvedValue([]);
        const now = Math.floor(Date.now() / 1000);
        const apiPrograms = [
            buildProgram('Provider Show', now - 600, now + 600),
        ];
        xtreamApiService.getFullEpg.mockResolvedValue(apiPrograms);

        const result = await store.loadEpg();

        expect(fallbackService.getProgramsForChannel).toHaveBeenCalledWith(
            'rtl.de'
        );
        expect(xtreamApiService.getFullEpg).toHaveBeenCalled();
        expect(result).toEqual(apiPrograms);
    });
});
