import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { SearchLayoutComponent } from './search-layout.component';

describe('SearchLayoutComponent', () => {
    let fixture: ComponentFixture<SearchLayoutComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SearchLayoutComponent],
        })
            .overrideComponent(SearchLayoutComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(SearchLayoutComponent);
    });

    function renderResultsContainer(): HTMLElement {
        fixture.componentRef.setInput('searchTerm', 'matrix');
        fixture.componentRef.setInput('resultsCount', 1);
        fixture.detectChanges();

        return fixture.debugElement.query(By.css('.results-container'))
            .nativeElement as HTMLElement;
    }

    function setScrollMetrics(
        element: HTMLElement,
        scrollTop: number,
        scrollHeight = 1000,
        clientHeight = 120
    ): void {
        Object.defineProperties(element, {
            scrollHeight: {
                configurable: true,
                value: scrollHeight,
            },
            scrollTop: {
                configurable: true,
                value: scrollTop,
            },
            clientHeight: {
                configurable: true,
                value: clientHeight,
            },
        });
    }

    it('shows the back button only when showBackButton is set and emits backClick', () => {
        fixture.detectChanges();
        expect(
            fixture.debugElement.query(By.css('.header-back'))
        ).toBeNull();

        fixture.componentRef.setInput('showBackButton', true);
        fixture.detectChanges();

        const backButton = fixture.debugElement.query(By.css('.header-back'));
        expect(backButton).not.toBeNull();

        const emitted: unknown[] = [];
        fixture.componentInstance.backClick.subscribe((value) =>
            emitted.push(value)
        );
        (backButton.nativeElement as HTMLButtonElement).click();
        expect(emitted).toHaveLength(1);
    });

    it('emits nearEnd when the results container is scrolled near the bottom', () => {
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 700);

        resultsContainer.dispatchEvent(new Event('scroll'));

        expect(nearEndSpy).toHaveBeenCalledTimes(1);
    });

    it('emits nearEnd only when crossing into the bottom threshold', () => {
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 500);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).not.toHaveBeenCalled();

        setScrollMetrics(resultsContainer, 700);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(1);

        setScrollMetrics(resultsContainer, 710);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(1);

        setScrollMetrics(resultsContainer, 500);
        resultsContainer.dispatchEvent(new Event('scroll'));
        setScrollMetrics(resultsContainer, 760);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(2);
    });

    it('resets the near-end latch when the reset identity changes without a new term', () => {
        // Regression: a filter-only search transition replaces the result set
        // while the term stays the same; the latch must not survive it.
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 700);
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(1);

        fixture.componentRef.setInput('nearEndResetKey', 'matrix|movie-only');
        fixture.detectChanges();

        // Still inside the threshold — a stale latch would swallow this.
        resultsContainer.dispatchEvent(new Event('scroll'));
        expect(nearEndSpy).toHaveBeenCalledTimes(2);
    });

    it('does not emit nearEnd when the consumer reports no more results', () => {
        const nearEndSpy = jest.fn();
        fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
        fixture.componentRef.setInput('nearEndHasMore', false);
        const resultsContainer = renderResultsContainer();

        setScrollMetrics(resultsContainer, 500);
        resultsContainer.dispatchEvent(new Event('scroll'));
        setScrollMetrics(resultsContainer, 700);
        resultsContainer.dispatchEvent(new Event('scroll'));

        expect(nearEndSpy).not.toHaveBeenCalled();
    });

    it('re-measures when the rendered window grows while the total stays constant', () => {
        // Regression (bots, round 2): binding the constant result-set total to
        // the directive left no tracked input changing after the consumer
        // revealed a chunk, so the auto-fill stopped after one expansion.
        const rafCallbacks: FrameRequestCallback[] = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback: FrameRequestCallback) => {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            () => undefined
        );

        try {
            const nearEndSpy = jest.fn();
            fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
            fixture.componentRef.setInput('searchTerm', 'matrix');
            fixture.componentRef.setInput('resultsCount', 130);
            fixture.componentRef.setInput('nearEndRenderedCount', 60);
            fixture.detectChanges();

            const flush = () => {
                while (rafCallbacks.length) {
                    const callback = rafCallbacks.shift();
                    callback?.(0);
                }
            };

            flush();
            expect(nearEndSpy).toHaveBeenCalledTimes(1);

            // The consumer reveals the next chunk; the total does not change,
            // but the rendered count must schedule another overflow check.
            fixture.componentRef.setInput('nearEndRenderedCount', 120);
            fixture.detectChanges();
            flush();
            expect(nearEndSpy).toHaveBeenCalledTimes(2);
        } finally {
            jest.restoreAllMocks();
        }
    });

    it('auto-fills via nearEnd when the rendered results do not overflow', () => {
        // Regression: a result window larger than the viewport-visible chunk
        // must not stall when the rendered cards never create a scrollbar —
        // the overflow check has to reveal further chunks without any scroll.
        const rafCallbacks: FrameRequestCallback[] = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback: FrameRequestCallback) => {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            () => undefined
        );

        try {
            const nearEndSpy = jest.fn();
            fixture.componentInstance.nearEnd.subscribe(nearEndSpy);
            renderResultsContainer();

            // JSDOM default geometry (all zeros) models a non-overflowing
            // container; flushing the scheduled overflow check must emit.
            while (rafCallbacks.length) {
                const callback = rafCallbacks.shift();
                callback?.(0);
            }

            expect(nearEndSpy).toHaveBeenCalled();
        } finally {
            jest.restoreAllMocks();
        }
    });
});
