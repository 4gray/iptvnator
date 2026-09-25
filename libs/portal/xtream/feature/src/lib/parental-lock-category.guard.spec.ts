import { TestBed } from '@angular/core/testing';
import {
    ActivatedRouteSnapshot,
    convertToParamMap,
    Router,
    RouterStateSnapshot,
    UrlTree,
} from '@angular/router';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { parentalLockXtreamCategoryGuard } from './parental-lock-category.guard';

function createRoute(
    playlistId: string,
    categoryId: string,
    itemParams: Record<string, string> = {}
) {
    const parent = {
        paramMap: convertToParamMap({ id: playlistId }),
    } as ActivatedRouteSnapshot;
    const route = {
        paramMap: convertToParamMap({ categoryId, ...itemParams }),
    } as ActivatedRouteSnapshot;
    Object.defineProperty(route, 'pathFromRoot', {
        value: [parent, route],
    });
    return route;
}

describe('parentalLockXtreamCategoryGuard', () => {
    let parentalLock: {
        initialize: jest.Mock;
        active: jest.Mock;
        isXtreamCategoryLocked: jest.Mock;
        requestUnlock: jest.Mock;
    };
    let databaseService: { getAllXtreamCategories: jest.Mock };
    let runtime: { supportsXtreamSqliteDataSource: boolean };
    let router: { createUrlTree: jest.Mock };
    let dataSource: {
        getContentByXtreamId: jest.Mock;
        getPlaylist: jest.Mock;
        getContent: jest.Mock;
    };

    beforeEach(() => {
        parentalLock = {
            initialize: jest.fn().mockResolvedValue(undefined),
            active: jest.fn(() => true),
            isXtreamCategoryLocked: jest.fn(() => false),
            requestUnlock: jest.fn().mockResolvedValue(false),
        };
        databaseService = {
            getAllXtreamCategories: jest
                .fn()
                .mockResolvedValue([
                    { id: 12, xtream_id: 900, type: 'movies' },
                ]),
        };
        runtime = { supportsXtreamSqliteDataSource: true };
        router = { createUrlTree: jest.fn(() => ({}) as UrlTree) };
        dataSource = {
            getContentByXtreamId: jest.fn().mockResolvedValue(null),
            getPlaylist: jest.fn().mockResolvedValue({
                serverUrl: 'http://panel.example',
                username: 'u',
                password: 'p',
            }),
            getContent: jest.fn().mockResolvedValue([]),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: DatabaseService, useValue: databaseService },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: Router, useValue: router },
            ],
        });
    });

    function run(
        section: 'live' | 'vod' | 'series',
        categoryId: string,
        itemParams: Record<string, string> = {}
    ) {
        return TestBed.runInInjectionContext(() =>
            parentalLockXtreamCategoryGuard(section)(
                createRoute('playlist-1', categoryId, itemParams),
                {} as RouterStateSnapshot
            )
        );
    }

    it('checks a detail item against its own category, not the one in the URL', async () => {
        // Category row 12 (provider 900) is locked; row 13 (provider 901) is
        // not. The URL names the unlocked one but the movie belongs to the
        // locked one.
        databaseService.getAllXtreamCategories.mockResolvedValue([
            { id: 12, xtream_id: 900, type: 'movies' },
            { id: 13, xtream_id: 901, type: 'movies' },
        ]);
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlist: string, _type: string, xtreamId: number) =>
                xtreamId === 900
        );
        dataSource.getContentByXtreamId.mockResolvedValue({ category_id: 12 });

        const result = await run('vod', '13', { vodId: '555' });

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            555,
            'playlist-1',
            'movie'
        );
        expect(parentalLock.requestUnlock).toHaveBeenCalled();
        expect(result).not.toBe(true);

        // A movie in an unlocked category passes without a prompt.
        parentalLock.requestUnlock.mockClear();
        dataSource.getContentByXtreamId.mockResolvedValue({ category_id: 13 });
        await expect(run('vod', '13', { vodId: '556' })).resolves.toBe(true);
        expect(parentalLock.requestUnlock).not.toHaveBeenCalled();
    });

    it('passes through while the lock is inactive without touching the database', async () => {
        parentalLock.active.mockReturnValue(false);

        await expect(run('vod', '12')).resolves.toBe(true);
        expect(databaseService.getAllXtreamCategories).not.toHaveBeenCalled();
    });

    it('maps the Electron row id to the provider id and redirects a refused locked category', async () => {
        parentalLock.isXtreamCategoryLocked.mockReturnValue(true);

        const result = await run('vod', '12');

        expect(parentalLock.isXtreamCategoryLocked).toHaveBeenCalledWith(
            'playlist-1',
            'movies',
            900
        );
        expect(parentalLock.requestUnlock).toHaveBeenCalled();
        expect(router.createUrlTree).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
        ]);
        expect(result).not.toBe(true);
    });

    it('lets an entered PIN through', async () => {
        parentalLock.isXtreamCategoryLocked.mockReturnValue(true);
        parentalLock.requestUnlock.mockResolvedValue(true);

        await expect(run('series', '12')).resolves.toBe(true);
        expect(router.createUrlTree).not.toHaveBeenCalled();
    });

    it('hydrates the PWA session cache before judging a detail item on a cold navigation', async () => {
        runtime.supportsXtreamSqliteDataSource = false;
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_playlist: string, _type: string, xtreamId: number) =>
                xtreamId === 900
        );
        dataSource.getContentByXtreamId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ category_id: '900' });

        const result = await run('vod', '901', { vodId: '555' });

        expect(dataSource.getContent).toHaveBeenCalledWith(
            'playlist-1',
            { serverUrl: 'http://panel.example', username: 'u', password: 'p' },
            'movie'
        );
        expect(parentalLock.requestUnlock).toHaveBeenCalled();
        expect(result).not.toBe(true);
    });

    it('fails closed for a detail item the catalog cannot place', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await run('series', '13', { serialId: '777' });

        expect(parentalLock.requestUnlock).toHaveBeenCalled();
        expect(result).not.toBe(true);
    });

    it('uses the route id as the provider id in the PWA', async () => {
        runtime.supportsXtreamSqliteDataSource = false;

        await run('live', '77');

        expect(databaseService.getAllXtreamCategories).not.toHaveBeenCalled();
        expect(parentalLock.isXtreamCategoryLocked).toHaveBeenCalledWith(
            'playlist-1',
            'live',
            77
        );
    });
});
