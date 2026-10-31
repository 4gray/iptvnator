import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PortalCatalogHideWatched } from '@iptvnator/portal/shared/util';
import { CategoryContentViewComponent } from '../category-content-view.component';

/** Companion cases share the existing catalog fixture without enlarging its suite. */
export function registerHideWatchedCases({
    getFixture,
    catalog,
    isPaginatedContentLoading,
    categoryItemCount,
    hasMore,
}: {
    getFixture(): ComponentFixture<CategoryContentViewComponent>;
    catalog: {
        provider: 'xtream' | 'stalker';
        hideWatched?: PortalCatalogHideWatched;
        paginatedContent: WritableSignal<unknown[]>;
    };
    isPaginatedContentLoading: WritableSignal<boolean>;
    categoryItemCount: WritableSignal<number>;
    hasMore: WritableSignal<boolean>;
}) {
    it('offers only the Stalker hide-watched checkbox, with a removable chip and truthful loaded count', () => {
        const enabled = signal(false);
        const setEnabled = jest.fn((value: boolean) => enabled.set(value));
        catalog.provider = 'stalker';
        catalog.hideWatched = {
            enabled,
            loadState: signal('ready'),
            hasSnapshot: signal(true),
            paused: signal(false),
            resumeVersion: signal(0),
            setEnabled,
            retryPositions: jest.fn(),
            continueLoading: jest.fn(),
            pauseAutomaticLoading: jest.fn(),
        };
        isPaginatedContentLoading.set(false);
        categoryItemCount.set(100);
        catalog.paginatedContent.set([{ id: 2 }]);
        getFixture().detectChanges();
        getFixture().nativeElement.querySelector('.refine-action').click();
        getFixture().detectChanges();
        const checkbox = document.querySelector<HTMLButtonElement>(
            '[role="menuitemcheckbox"]'
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox?.getAttribute('aria-checked')).toBe('false');
        checkbox?.click();
        getFixture().detectChanges();
        expect(setEnabled).toHaveBeenCalledWith(true);
        expect(getFixture().componentInstance.activeRefinementCount()).toBe(1);
        expect(getFixture().componentInstance.categoryItemSubtitle()).toEqual({
            key: 'WORKSPACE.REFINE_HIDE_WATCHED_COUNT',
            params: { shown: 1, count: 100 },
        });
        getFixture().nativeElement.querySelector('.hide-watched-chip').click();
        getFixture().detectChanges();
        expect(setEnabled).toHaveBeenLastCalledWith(false);
        catalog.paginatedContent.set([]);
    });

    it('disables the checkbox without a progress snapshot and exposes progress retry', () => {
        catalog.provider = 'stalker';
        const retryPositions = jest.fn();
        catalog.hideWatched = {
            enabled: signal(false),
            loadState: signal('error'),
            hasSnapshot: signal(false),
            paused: signal(false),
            resumeVersion: signal(0),
            setEnabled: jest.fn(),
            retryPositions,
            continueLoading: jest.fn(),
            pauseAutomaticLoading: jest.fn(),
        };
        isPaginatedContentLoading.set(false);
        getFixture().detectChanges();
        expect(
            getFixture().nativeElement.querySelector(
                '.catalog-progress-notice[role="alert"]'
            )
        ).not.toBeNull();
        getFixture()
            .nativeElement.querySelector('.catalog-progress-notice button')
            .click();
        expect(retryPositions).toHaveBeenCalledTimes(1);
        getFixture().nativeElement.querySelector('.refine-action').click();
        getFixture().detectChanges();
        expect(
            document.querySelector<HTMLButtonElement>(
                '[role="menuitemcheckbox"]'
            )?.disabled
        ).toBe(true);
    });

    it('keeps source has-more separate from the paused automatic-loading gate', () => {
        catalog.hideWatched = {
            enabled: signal(true),
            loadState: signal('ready'),
            hasSnapshot: signal(true),
            paused: signal(true),
            resumeVersion: signal(0),
            setEnabled: jest.fn(),
            retryPositions: jest.fn(),
            continueLoading: jest.fn(),
            pauseAutomaticLoading: jest.fn(),
        };
        hasMore.set(true);
        isPaginatedContentLoading.set(false);
        getFixture().detectChanges();
        expect(getFixture().componentInstance.sourceHasMore()).toBe(true);
        expect(getFixture().componentInstance.infiniteHasMore()).toBe(false);
        const grid = getFixture().debugElement.query(By.css('app-grid-list'))
            .componentInstance as {
            sourceHasMore(): boolean;
            loadMorePaused(): boolean;
            continueLoading: { emit(): void };
        };
        expect(grid.sourceHasMore()).toBe(true);
        expect(grid.loadMorePaused()).toBe(true);
        grid.continueLoading.emit();
        expect(catalog.hideWatched.continueLoading).toHaveBeenCalledTimes(1);
    });
}
