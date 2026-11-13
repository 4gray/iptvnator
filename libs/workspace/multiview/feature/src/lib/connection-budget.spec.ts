import { TestBed } from '@angular/core/testing';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import {
    connectionBudgetBadge,
    connectionBudgetFromUserInfo,
    connectionMeter,
} from './connection-budget';
import { ConnectionBudgetService } from './connection-budget.service';

describe('connection budget', () => {
    it('reads max_connections and active_cons from user_info', () => {
        expect(
            connectionBudgetFromUserInfo(
                { max_connections: '2', active_cons: '1' },
                'Synthetic Provider'
            )
        ).toEqual({
            playlistName: 'Synthetic Provider',
            maxConnections: 2,
            activeConnections: 1,
        });
    });

    it.each([
        [null],
        [{}],
        [{ max_connections: '0', active_cons: '0' }],
        [{ max_connections: 'unlimited' }],
    ])('has no budget without a positive limit: %j', (info) => {
        expect(connectionBudgetFromUserInfo(info, 'p')).toBeNull();
    });

    it('reads a missing or broken active count as none', () => {
        expect(
            connectionBudgetFromUserInfo({ max_connections: 3 }, 'p')
                ?.activeConnections
        ).toBe(0);
    });

    it.each([
        [
            { maxConnections: 2, activeConnections: 1 },
            { kind: 'free', free: 1 },
        ],
        [{ maxConnections: 2, activeConnections: 2 }, { kind: 'full' }],
        [{ maxConnections: 1, activeConnections: 3 }, { kind: 'full' }],
    ])('badges %j', (counts, badge) => {
        expect(connectionBudgetBadge({ playlistName: 'p', ...counts })).toEqual(
            badge
        );
    });

    it('badges a provider without a budget as unknown', () => {
        expect(connectionBudgetBadge(null)).toEqual({ kind: 'unknown' });
    });

    it('draws the footer meter with used segments first', () => {
        expect(
            connectionMeter({
                playlistName: 'p',
                maxConnections: 3,
                activeConnections: 1,
            })
        ).toEqual(['used', 'free', 'free']);
    });
});

describe('ConnectionBudgetService', () => {
    const getAccountInfo = jest.fn();
    const getPlaylistById = jest.fn();

    beforeEach(() => {
        getAccountInfo.mockReset();
        getPlaylistById.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamApiService, useValue: { getAccountInfo } },
                { provide: PlaylistsService, useValue: { getPlaylistById } },
            ],
        });
    });

    const service = () => TestBed.inject(ConnectionBudgetService);

    it('asks an Xtream panel for its budget each time', async () => {
        getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-1',
                title: 'Synthetic Provider',
                serverUrl: 'http://xtream.example',
                username: 'user',
                password: 'secret',
            })
        );
        getAccountInfo.mockResolvedValue({
            user_info: { max_connections: '1', active_cons: '1' },
        });

        await service().budgetFor('playlist-1');
        const budget = await service().budgetFor('playlist-1');

        expect(getAccountInfo).toHaveBeenCalledTimes(2);
        expect(getAccountInfo).toHaveBeenCalledWith(
            {
                serverUrl: 'http://xtream.example',
                username: 'user',
                password: 'secret',
                userAgent: undefined,
            },
            { suppressErrorLog: true }
        );
        expect(budget).toMatchObject({
            maxConnections: 1,
            activeConnections: 1,
        });
    });

    it.each([
        ['an M3U playlist', { _id: 'm', url: 'https://list.example/a.m3u' }],
        [
            'a Stalker portal',
            {
                _id: 's',
                serverUrl: 'http://portal.example',
                username: 'u',
                password: 'p',
                macAddress: '00:1A:79:00:00:00',
            },
        ],
        ['a missing playlist', undefined],
    ])('reports no budget for %s', async (_label, playlist) => {
        getPlaylistById.mockReturnValue(of(playlist));

        await expect(service().budgetFor('x')).resolves.toBeNull();
        expect(getAccountInfo).not.toHaveBeenCalled();
    });

    it('reports no budget when the panel cannot be reached', async () => {
        getPlaylistById.mockReturnValue(
            of({
                _id: 'x',
                serverUrl: 'http://x.example',
                username: 'u',
                password: 'p',
            })
        );
        getAccountInfo.mockRejectedValue(new Error('offline'));

        await expect(service().budgetFor('x')).resolves.toBeNull();
    });
});
