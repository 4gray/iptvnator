import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createLivePanelsController } from './live-panels-controller';
import { LIVE_CATEGORIES_POPOVER } from './live-categories-popover.token';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import { liveSidebarStateStorageKey } from './live-sidebar-state';

describe('LivePanelsController', () => {
    const popover = {
        open: jest.fn(),
        close: jest.fn(),
        showCategoriesPanel: jest.fn(),
    };
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
                showCategoriesButton: signal(new ElementRef(showButton)),
                restoreButton: signal(new ElementRef(restoreButton)),
            })
        );
    }

    async function settle(): Promise<void> {
        TestBed.flushEffects();
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    }

    beforeEach(() => {
        localStorage.removeItem(liveSidebarStateStorageKey('portal'));
        popover.open.mockClear();
        popover.close.mockClear();
        popover.showCategoriesPanel.mockClear();
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

    it('offers the dropdown with a provider and a folded rail, selected category or not', () => {
        const controller = create();
        const state = TestBed.inject(LiveLayoutSidebarStateService);
        expect(controller.canOpenCategoriesPopover()).toBe(false);
        expect(controller.isCategoriesRailFolded()).toBe(false);

        state.hideCategories('portal');
        expect(controller.canOpenCategoriesPopover()).toBe(true);
        expect(controller.isCategoriesRailFolded()).toBe(true);
        expect(controller.effectiveLevel()).toBe('categories-hidden');

        // Player only: the floating restore handle replaces the header.
        state.collapse('portal');
        expect(controller.isCategoriesRailFolded()).toBe(false);
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
        // The shell restores the rail (and opens the phone drawer if the
        // rail is one); the controller only delegates.
        expect(popover.showCategoriesPanel).toHaveBeenCalledTimes(1);
        expect(state.stateOf('portal')()).toBe('categories-hidden');
    });

    it('hands focus across level changes', async () => {
        const controller = create();
        const state = TestBed.inject(LiveLayoutSidebarStateService);
        await settle();

        state.hideCategories('portal');
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
