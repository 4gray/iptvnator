import { TestBed } from '@angular/core/testing';
import {
    ActivatedRouteSnapshot,
    convertToParamMap,
    Router,
    RouterStateSnapshot,
    UrlTree,
} from '@angular/router';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { parentalLockXtreamCategoryGuard } from './parental-lock-category.guard';

function createRoute(playlistId: string, categoryId: string) {
    const parent = {
        paramMap: convertToParamMap({ id: playlistId }),
    } as ActivatedRouteSnapshot;
    const route = {
        paramMap: convertToParamMap({ categoryId }),
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
        TestBed.configureTestingModule({
            providers: [
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: DatabaseService, useValue: databaseService },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: Router, useValue: router },
            ],
        });
    });

    function run(section: 'live' | 'vod' | 'series', categoryId: string) {
        return TestBed.runInInjectionContext(() =>
            parentalLockXtreamCategoryGuard(section)(
                createRoute('playlist-1', categoryId),
                {} as RouterStateSnapshot
            )
        );
    }

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
