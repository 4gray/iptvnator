import { TestBed } from '@angular/core/testing';
import { DatabaseService, type PortalContentSeeder } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { XtreamContentSeedService } from './xtream-content-seed.service';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import type { CategoryType, StreamType } from './services/xtream-api.service';
import { SettingsStore } from '@iptvnator/services';

describe('XtreamContentSeedService', () => {
    let dataSource: {
        getCategories: jest.Mock;
        getContent: jest.Mock;
    };
    let databaseService: { setXtreamImportStatus: jest.Mock };
    let settingsStore: { disableVod: jest.Mock };
    let seedService: PortalContentSeeder;

    function xtreamPlaylist(scope: Partial<Playlist> = {}): Playlist {
        return {
            _id: 'playlist-1',
            title: 'Panel',
            serverUrl: 'http://panel.example',
            username: 'user',
            password: 'pass',
            ...scope,
        } as Playlist;
    }

    beforeEach(() => {
        dataSource = {
            getCategories: jest.fn().mockResolvedValue([]),
            getContent: jest.fn().mockResolvedValue([{ xtream_id: 1 }]),
        };
        databaseService = {
            setXtreamImportStatus: jest.fn().mockResolvedValue(true),
        };
        settingsStore = { disableVod: jest.fn(() => false) };
        TestBed.configureTestingModule({
            providers: [
                XtreamContentSeedService,
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
                { provide: DatabaseService, useValue: databaseService },
                { provide: SettingsStore, useValue: settingsStore },
            ],
        });
        seedService = TestBed.inject(XtreamContentSeedService);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('seeds live-only catalogs when the row declines VOD', async () => {
        await seedService.seed(xtreamPlaylist({ importVod: false }));

        const categories = dataSource.getCategories.mock.calls.map(
            ([, , type]: [string, unknown, CategoryType]) => type
        );
        const content = dataSource.getContent.mock.calls.map(
            ([, , type]: [string, unknown, StreamType]) => type
        );
        expect(categories).toEqual(['live']);
        expect(content).toEqual(['live']);
        // Marks the seeded section complete so the workspace's first open
        // hydrates from the cache instead of re-fetching the portal.
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledWith(
            'playlist-1',
            'live',
            'completed'
        );
    });

    it('seeds every section when the scope keeps VOD on', async () => {
        await seedService.seed(xtreamPlaylist());

        const content = dataSource.getContent.mock.calls.map(
            ([, , type]: [string, unknown, StreamType]) => type
        );
        expect(content).toEqual(['live', 'movie', 'series']);
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledTimes(3);
    });

    it.each([{}, { importLive: false }])(
        'honors the global Disable VOD setting over the row scope %p',
        async (scope) => {
            settingsStore.disableVod.mockReturnValue(true);

            await seedService.seed(xtreamPlaylist(scope));

            const categories = dataSource.getCategories.mock.calls.map(
                ([, , type]: [string, unknown, CategoryType]) => type
            );
            const content = dataSource.getContent.mock.calls.map(
                ([, , type]: [string, unknown, StreamType]) => type
            );
            expect(categories).toEqual(['live']);
            expect(content).toEqual(['live']);
        }
    );

    it('leaves rows without usable credentials unseeded', async () => {
        await seedService.seed(xtreamPlaylist({ password: '' }));

        expect(dataSource.getCategories).not.toHaveBeenCalled();
        expect(dataSource.getContent).not.toHaveBeenCalled();
    });

    it('rejects when the portal cannot be read so the import skips it', async () => {
        dataSource.getCategories.mockRejectedValueOnce(
            new Error('portal down')
        );

        await expect(seedService.seed(xtreamPlaylist())).rejects.toThrow(
            'portal down'
        );
        expect(dataSource.getContent).not.toHaveBeenCalled();
        expect(databaseService.setXtreamImportStatus).not.toHaveBeenCalled();
    });

    it('rejects a portal that answers without live channels', async () => {
        dataSource.getContent.mockResolvedValueOnce([]);

        await expect(
            seedService.seed(xtreamPlaylist({ importVod: false }))
        ).rejects.toThrow('no live channels');
        expect(databaseService.setXtreamImportStatus).not.toHaveBeenCalled();
    });
});
