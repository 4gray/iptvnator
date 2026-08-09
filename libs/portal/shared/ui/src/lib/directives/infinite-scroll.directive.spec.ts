import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { InfiniteScrollDirective } from './infinite-scroll.directive';

@Component({
    template: `<div
        class="scroll-host"
        appInfiniteScroll
        [infiniteHasMore]="hasMore()"
        [infiniteAppending]="appending()"
        [infiniteItemCount]="itemCount()"
        [infiniteResetKey]="resetKey()"
        (infiniteLoadMore)="onLoadMore()"
    ></div>`,
    imports: [InfiniteScrollDirective],
})
class TestHostComponent {
    readonly hasMore = signal(true);
    readonly appending = signal(false);
    readonly itemCount = signal(0);
    readonly resetKey = signal('a');
    loads = 0;

    onLoadMore(): void {
        this.loads += 1;
    }
}

describe('InfiniteScrollDirective', () => {
    let fixture: ComponentFixture<TestHostComponent>;
    let host: TestHostComponent;
    let scrollHost: HTMLElement;
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(async () => {
        rafCallbacks = [];
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback: FrameRequestCallback) => {
                rafCallbacks.push(callback);
                return rafCallbacks.length;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            () => undefined
        );

        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(TestHostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
        scrollHost = fixture.debugElement.query(By.css('.scroll-host'))
            .nativeElement as HTMLElement;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function setScrollMetrics(
        scrollTop: number,
        scrollHeight = 1000,
        clientHeight = 120
    ): void {
        Object.defineProperties(scrollHost, {
            scrollHeight: { configurable: true, value: scrollHeight },
            scrollTop: { configurable: true, value: scrollTop },
            clientHeight: { configurable: true, value: clientHeight },
        });
    }

    function flushScheduledChecks(): void {
        while (rafCallbacks.length) {
            const callback = rafCallbacks.shift();
            callback?.(0);
        }
    }

    it('emits loadMore only when crossing into the bottom threshold', () => {
        flushScheduledChecks();
        host.loads = 0;

        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(0);

        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(1);

        // Still inside the threshold — no re-fire without leaving it first.
        setScrollMetrics(710);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(1);

        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        setScrollMetrics(760);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(2);
    });

    it('does not emit on scroll while appending or when nothing more exists', () => {
        flushScheduledChecks();
        host.loads = 0;

        host.appending.set(true);
        fixture.detectChanges();
        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(0);

        host.appending.set(false);
        host.hasMore.set(false);
        fixture.detectChanges();
        flushScheduledChecks();
        host.loads = 0;
        setScrollMetrics(0);
        scrollHost.dispatchEvent(new Event('scroll'));
        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(0);
    });

    it('auto-fills when the container does not overflow the viewport', () => {
        // JSDOM default geometry (all zeros) models an unfilled container.
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();

        expect(host.loads).toBe(1);
    });

    it('re-checks the fill after an append settles and stops at the cap', () => {
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();
        expect(host.loads).toBe(1);

        // Each "append" changes the item count while the container still does
        // not overflow — the directive keeps requesting up to the cap of 10.
        for (let round = 0; round < 20; round++) {
            host.itemCount.update((count) => count + 14);
            fixture.detectChanges();
            flushScheduledChecks();
        }

        expect(host.loads).toBe(10);
    });

    it('resets the auto-fill budget when the reset key changes', () => {
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();
        for (let round = 0; round < 20; round++) {
            host.itemCount.update((count) => count + 14);
            fixture.detectChanges();
            flushScheduledChecks();
        }
        expect(host.loads).toBe(10);

        host.resetKey.set('b');
        fixture.detectChanges();
        flushScheduledChecks();

        expect(host.loads).toBe(11);
    });

    it('clears a stale near-end latch when appended content moves the bottom away', () => {
        // Empty container: the auto-fill fires and latches "within threshold".
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();
        expect(host.loads).toBe(1);

        // The append grows the content well past the threshold; the fill
        // check must refresh the latch from the measured state.
        setScrollMetrics(0, 2000, 400);
        host.itemCount.set(50);
        fixture.detectChanges();
        flushScheduledChecks();
        expect(host.loads).toBe(1);

        // Jumping straight to the bottom (End key / scrollbar drag) is a
        // genuine crossing again — a stale latch would swallow it.
        setScrollMetrics(1600, 2000, 400);
        scrollHost.dispatchEvent(new Event('scroll'));
        expect(host.loads).toBe(2);
    });

    it('does not auto-fill while an append is in flight', () => {
        setScrollMetrics(0, 0, 0);
        host.appending.set(true);
        fixture.detectChanges();
        flushScheduledChecks();
        host.loads = 0;

        host.itemCount.set(14);
        fixture.detectChanges();
        flushScheduledChecks();
        expect(host.loads).toBe(0);

        // The append settling schedules the next overflow check.
        host.appending.set(false);
        fixture.detectChanges();
        flushScheduledChecks();
        expect(host.loads).toBe(1);
    });
});
