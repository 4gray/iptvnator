import { TestBed } from '@angular/core/testing';
import {
    ActivatedRouteSnapshot,
    convertToParamMap,
    Router,
    RouterStateSnapshot,
    UrlTree,
} from '@angular/router';
import { ParentalLockService } from '@iptvnator/services';
import { parentalLockStalkerCategoryGuard } from './parental-lock-category.guard';

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

describe('parentalLockStalkerCategoryGuard', () => {
    let parentalLock: {
        initialize: jest.Mock;
        active: jest.Mock;
        isStalkerCategoryLocked: jest.Mock;
        requestUnlock: jest.Mock;
    };
    let router: { createUrlTree: jest.Mock };

    beforeEach(() => {
        parentalLock = {
            initialize: jest.fn().mockResolvedValue(undefined),
            active: jest.fn(() => true),
            isStalkerCategoryLocked: jest.fn(() => false),
            requestUnlock: jest.fn().mockResolvedValue(false),
        };
        router = { createUrlTree: jest.fn(() => ({}) as UrlTree) };
        TestBed.configureTestingModule({
            providers: [
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: Router, useValue: router },
            ],
        });
    });

    function run(section: 'vod' | 'series', categoryId: string) {
        return TestBed.runInInjectionContext(() =>
            parentalLockStalkerCategoryGuard(section)(
                createRoute('portal-1', categoryId),
                {} as RouterStateSnapshot
            )
        );
    }

    it('passes an unlocked genre and an inactive lock', async () => {
        await expect(run('vod', '9')).resolves.toBe(true);
        parentalLock.active.mockReturnValue(false);
        parentalLock.isStalkerCategoryLocked.mockReturnValue(true);
        await expect(run('vod', '9')).resolves.toBe(true);
    });

    it('prompts for a locked genre and redirects to the section root on refusal', async () => {
        parentalLock.isStalkerCategoryLocked.mockReturnValue(true);

        const result = await run('series', '9');

        expect(parentalLock.isStalkerCategoryLocked).toHaveBeenCalledWith(
            'portal-1',
            'series',
            '9'
        );
        expect(router.createUrlTree).toHaveBeenCalledWith([
            '/workspace',
            'stalker',
            'portal-1',
            'series',
        ]);
        expect(result).not.toBe(true);

        parentalLock.requestUnlock.mockResolvedValue(true);
        await expect(run('series', '9')).resolves.toBe(true);
    });
});
