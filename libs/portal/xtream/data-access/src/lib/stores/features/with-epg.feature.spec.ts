import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { DataService } from 'services';
import { EpgItem } from 'shared-interfaces';
import { XtreamApiService } from '../../services/xtream-api.service';
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

const TestEpgStore = signalStore(
    withState({
        currentPlaylist: PLAYLIST,
        selectedItem: { xtream_id: 101 },
    }),
    withEpg()
);

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

describe('withEpg', () => {
    let store: InstanceType<typeof TestEpgStore>;
    let xtreamApiService: {
        getFullEpg: jest.Mock<Promise<EpgItem[]>, unknown[]>;
        getShortEpg: jest.Mock<Promise<EpgItem[]>, unknown[]>;
    };

    beforeEach(() => {
        xtreamApiService = {
            getFullEpg: jest.fn(),
            getShortEpg: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestEpgStore,
                {
                    provide: DataService,
                    useValue: { isElectron: true },
                },
                {
                    provide: XtreamApiService,
                    useValue: xtreamApiService,
                },
            ],
        });

        store = TestBed.inject(TestEpgStore);
    });

    it('loads the full electron epg and derives the current program from timestamps', async () => {
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
            {
                suppressErrorLog: true,
            }
        );
        expect(result).toEqual(programs);
        expect(store.epgItems()).toEqual(programs);
        expect(store.currentEpgItem()).toEqual(programs[1]);
        expect(store.isLoadingEpg()).toBe(false);
    });
});
