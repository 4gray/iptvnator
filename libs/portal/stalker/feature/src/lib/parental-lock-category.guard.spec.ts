import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { TestBed } from '@angular/core/testing';
import {
    ActivatedRouteSnapshot,
    convertToParamMap,
    RedirectCommand,
    Router,
    RouterStateSnapshot,
    UrlTree,
} from '@angular/router';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
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
    let router: { createUrlTree: jest.Mock; currentNavigation: jest.Mock };

    beforeEach(() => {
        parentalLock = {
            initialize: jest.fn().mockResolvedValue(undefined),
            active: jest.fn(() => true),
            isStalkerCategoryLocked: jest.fn(() => false),
            requestUnlock: jest.fn().mockResolvedValue(false),
        };
        router = {
            currentNavigation: jest.fn(),
            createUrlTree: jest.fn(() => ({}) as UrlTree),
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: { playlists: () => [] },
                },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: Router, useValue: router },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () =>
                            of({ hiddenStalkerCategories: { vod: ['8'] } }),
                    },
                },
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

    it('redirects a hidden genre even while unlocked and skips the PIN prompt', async () => {
        parentalLock.active.mockReturnValue(false);
        expect(await run('vod', '8')).not.toBe(true);
        expect(router.createUrlTree).toHaveBeenCalledWith([
            '/workspace',
            'stalker',
            'portal-1',
            'vod',
        ]);
        expect(parentalLock.requestUnlock).not.toHaveBeenCalled();
        expect(await run('series', '8')).toBe(true);
    });

    it('retains a direct item handoff over All only after passing its parental gate', async () => {
        const state = {
            openStalkerItem: { id: 'film', category_id: '8' },
            stalkerReturnTo: '/workspace',
        };
        router.currentNavigation.mockReturnValue({ extras: { state } });
        parentalLock.isStalkerCategoryLocked.mockReturnValue(true);
        expect(await run('vod', '8')).not.toBeInstanceOf(RedirectCommand);
        expect(parentalLock.requestUnlock).toHaveBeenCalled();
        parentalLock.requestUnlock.mockResolvedValue(true);
        const allowed = await run('vod', '8');
        expect(allowed).toBeInstanceOf(RedirectCommand);
        expect(
            (allowed as RedirectCommand).navigationBehaviorOptions?.state
        ).toBe(state);
    });

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
