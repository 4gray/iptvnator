import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { DatabaseService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import { DashboardDataService } from './dashboard-data.service';

describe('DashboardDataService.matchesScope', () => {
    let service: DashboardDataService;

    const playlistsSignal = signal<PlaylistMeta[]>([
        {
            _id: 'm3u-1',
            title: 'M3U Playlist',
            count: 1,
            importDate: '2026-01-01T00:00:00.000Z',
            autoRefresh: false,
        },
        {
            _id: 'xtream-1',
            title: 'Xtream Playlist',
            count: 1,
            importDate: '2026-01-01T00:00:00.000Z',
            autoRefresh: false,
            serverUrl: 'https://example.com',
        },
    ]);

    const storeMock = {
        selectSignal: jest.fn((selector: unknown) => {
            if (selector === selectAllPlaylistsMeta) {
                return playlistsSignal;
            }
            return signal(null);
        }),
    };

    const dbServiceMock = {
        getGlobalRecentlyViewed: jest.fn(),
        getGlobalFavorites: jest.fn(),
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                DashboardDataService,
                { provide: Store, useValue: storeMock },
                { provide: DatabaseService, useValue: dbServiceMock },
            ],
        });
        service = TestBed.inject(DashboardDataService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('treats an empty provider scope as all providers', () => {
        const result = service.matchesScope('xtream-1', 'xtream', {
            providers: [],
            playlistIds: [],
        });

        expect(result).toBe(true);
    });

    it('filters out items when provider is excluded', () => {
        const result = service.matchesScope('xtream-1', 'xtream', {
            providers: ['stalker'],
            playlistIds: [],
        });

        expect(result).toBe(false);
    });

    it('filters out items when playlist is not selected', () => {
        const result = service.matchesScope('xtream-1', 'xtream', {
            providers: ['xtream'],
            playlistIds: ['m3u-1'],
        });

        expect(result).toBe(false);
    });

    it('uses playlist metadata as provider fallback when source is missing', () => {
        const result = service.matchesScope('xtream-1', undefined, {
            providers: ['xtream'],
            playlistIds: [],
        });

        expect(result).toBe(true);
    });
});
