import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createLivePanelsController } from './live-panels-controller';
import { LIVE_CATEGORIES_POPOVER } from './live-categories-popover.token';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import { liveSidebarStateStorageKey } from './live-sidebar-state';

describe('LivePanelsController', () => {
    const popover = { open: jest.fn(), close: jest.fn() };
    const hasSelectedCategory = signal(true);
    let showButton: HTMLButtonElement;
    let restoreButton: HTMLButtonElement;

    function create(withPopover = true) {
        TestBed.configureTestingModule({
            providers: withPopover
                ? [{ provide: LIVE_CATEGORIES_POPOVER, useValue: popover }]
                : [],
        });
        return TestBed.runInInjectionContext(() =>
            createLivePanelsController({
                surface: 'portal',
                hasSelectedCategory,
                showCategoriesButton: signal(new ElementRef(showButton)),
                restoreButton: signal(new ElementRef(restoreButton)),
            })
        );
    }

    async function settle(): Promise<void> {
        TestBed.flushEffects();
        await new Promise((resolve) => queueMicrotask(resolve));
    }

    beforeEach(() => {
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
        popover.open.mockClear();
        popover.close.mockClear();
        hasSelectedCategory.set(true);
        showButton = document.createElement('button');
        restoreButton = document.createElement('button');
        document.body.append(showButton, restoreButton);
    });

    afterEach(() => {
        showButton.remove();
        restoreButton.remove();
        TestBed.inject(LiveLayoutSidebarStateService).setState('portal', 'expanded');
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
    });

    it('offers the dropdown only with a provider, a folded rail and a selected category', () => {
        const controller = create();
        const state = TestBed.inject(LiveLayoutSidebarStateService);
        expect(controller.canOpenCategoriesPopover()).toBe(false);

        state.hideCategories('portal');
        expect(controller.canOpenCategoriesPopover()).toBe(true);
        expect(controller.effectiveLevel()).toBe('categories-hidden');

        hasSelectedCategory.set(false);
        expect(controller.canOpenCategoriesPopover()).toBe(false);
        expect(controller.effectiveLevel()).toBe('expanded');

        state.collapse('portal');
        expect(controller.effectiveLevel()).toBe('collapsed');
    });

    it('keeps the plain heading without a popover provider', () => {
        const controller = create(false);
        TestBed.inject(LiveLayoutSidebarStateService).hideCategories('portal');

        expect(controller.canOpenCategoriesPopover()).toBe(false);
        controller.openCategoriesPopover(showButton);
        controller.showCategories();
        expect(TestBed.inject(LiveLayoutSidebarStateService).stateOf('portal')()).toBe(
            'expanded'
        );
    });

    it('routes the actions through the shared state and the popover', () => {
        const controller = create();
        const state = TestBed.inject(LiveLayoutSidebarStateService);

        controller.openCategoriesPopover(showButton);
        expect(popover.open).toHaveBeenCalledWith(showButton);

        controller.collapsePanels();
        expect(state.stateOf('portal')()).toBe('collapsed');
        controller.toggleSidebar();
        expect(state.stateOf('portal')()).toBe('expanded');

        state.hideCategories('portal');
        controller.showCategories();
        expect(popover.close).toHaveBeenCalledTimes(1);
        expect(state.stateOf('portal')()).toBe('expanded');
    });

    it('hands focus across level changes, including a fold by category selection', async () => {
        const controller = create();
        const state = TestBed.inject(LiveLayoutSidebarStateService);
        hasSelectedCategory.set(false);
        state.hideCategories('portal');
        await settle();
        (document.activeElement as HTMLElement | null)?.blur();

        // Live root: selecting the first category folds the rail.
        hasSelectedCategory.set(true);
        await settle();
        expect(document.activeElement).toBe(showButton);

        (document.activeElement as HTMLElement | null)?.blur();
        controller.collapsePanels();
        await settle();
        expect(document.activeElement).toBe(restoreButton);

        (document.activeElement as HTMLElement | null)?.blur();
        controller.toggleSidebar();
        await settle();
        expect(document.activeElement).toBe(showButton);
    });
});
