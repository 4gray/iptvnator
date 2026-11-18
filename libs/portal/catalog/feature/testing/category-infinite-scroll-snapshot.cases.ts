import { ComponentFixture } from '@angular/core/testing';
import { CategoryContentViewComponent } from '../src/lib/category-content-view/category-content-view.component';

export function registerInfiniteScrollSnapshotCases({
    createFixture,
    catalog,
    navigate,
    flushAnimationFrames,
}: {
    createFixture(): ComponentFixture<CategoryContentViewComponent>;
    catalog: {
        saveScrollPosition: jest.Mock;
        selectItem: jest.Mock;
        consumeSavedScrollPosition: jest.Mock;
    };
    navigate(): jest.Mock;
    flushAnimationFrames(): void;
}): void {
    it('saves the grid scroll position before opening a detail', () => {
        const infiniteFixture = createFixture();
        infiniteFixture.detectChanges();
        const grid = infiniteFixture.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement;
        Object.defineProperty(grid, 'scrollTop', {
            configurable: true,
            value: 333,
        });

        infiniteFixture.componentInstance.onItemClick({ xtream_id: 42 });

        expect(catalog.saveScrollPosition).toHaveBeenCalledWith(333);
    });

    it('keeps the detail snapshot when the outgoing grid resets before destruction', () => {
        const infiniteFixture = createFixture();
        infiniteFixture.detectChanges();
        const grid = infiniteFixture.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement;
        let scrollTop = 333;
        Object.defineProperty(grid, 'scrollTop', { get: () => scrollTop });
        catalog.selectItem.mockReturnValue(['42']);
        navigate().mockReturnValueOnce(new Promise(() => undefined));

        infiniteFixture.componentInstance.onItemClick({ xtream_id: 42 });
        expect(navigate()).toHaveBeenCalled();
        scrollTop = 0;
        grid.dispatchEvent(new Event('scroll'));
        infiniteFixture.destroy();

        expect(catalog.saveScrollPosition.mock.calls).toEqual([[333]]);
    });

    it('saves the offset the grid last reported when it is destroyed detached', () => {
        const infiniteFixture = createFixture();
        infiniteFixture.detectChanges();
        const grid = infiniteFixture.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement;
        // A detached element reports scrollTop 0, as in a browser.
        Object.defineProperty(grid, 'scrollTop', {
            configurable: true,
            get: () => (grid.isConnected ? 420 : 0),
        });
        grid.dispatchEvent(new Event('scroll'));

        // The view's DOM leaves the document before ngOnDestroy runs.
        infiniteFixture.nativeElement.remove();
        infiniteFixture.destroy();

        expect(catalog.saveScrollPosition).toHaveBeenCalledWith(420);
    });

    it('consumes a saved scroll position once the list is rendered', () => {
        catalog.consumeSavedScrollPosition.mockReturnValue(500);
        const infiniteFixture = createFixture();

        infiniteFixture.detectChanges();

        expect(catalog.consumeSavedScrollPosition).toHaveBeenCalledTimes(1);

        const grid = infiniteFixture.nativeElement.querySelector(
            'app-grid-list'
        ) as HTMLElement;
        const scrollTo = jest.fn();
        Object.defineProperty(grid, 'scrollTo', {
            configurable: true,
            value: scrollTo,
        });

        flushAnimationFrames();

        expect(scrollTo).toHaveBeenCalledWith({ top: 500 });
    });
}
