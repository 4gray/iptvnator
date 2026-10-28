import {
    Component,
    signal,
    ChangeDetectionStrategy,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
} from '@angular/core';
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
        [infiniteThresholdPx]="threshold()"
        (infiniteLoadMore)="onLoadMore()"
    ></div>`,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [InfiniteScrollDirective],
})
class TestHostComponent {
    readonly hasMore = signal(true);
    readonly appending = signal(false);
    readonly itemCount = signal(0);
    readonly resetKey = signal('a');
    readonly threshold = signal(240);
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

    /** The load requested by a scroll is emitted in a task after the scroll's frame. */
    function nextTask(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function flushScheduledChecks(): void {
        while (rafCallbacks.length) {
            const callback = rafCallbacks.shift();
            callback?.(0);
        }
    }

    it('emits loadMore only when crossing into the bottom threshold', async () => {
        flushScheduledChecks();
        host.loads = 0;

        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(0);

        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(1);

        // Still inside the threshold — no re-fire without leaving it first.
        setScrollMetrics(710);
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(1);

        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        setScrollMetrics(760);
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(2);
    });

    it('emits the load after the scroll event, not inside its frame', async () => {
        flushScheduledChecks();
        setScrollMetrics(500); // leave the threshold the initial fill latched
        scrollHost.dispatchEvent(new Event('scroll'));
        host.loads = 0;

        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        // A synchronous append would render a page of cards in the frame of
        // the key press that scrolled the list.
        expect(host.loads).toBe(0);
        await nextTask();
        expect(host.loads).toBe(1);
    });

    it('schedules no change detection for a scroll that requests nothing', () => {
        flushScheduledChecks();
        const scheduler = TestBed.inject(ChangeDetectionScheduler);
        const notify = jest.spyOn(scheduler, 'notify');

        setScrollMetrics(100);
        scrollHost.dispatchEvent(new Event('scroll'));

        expect(notify).not.toHaveBeenCalled();
    });

    it('requests the next page at the distance the surface asks for', async () => {
        host.threshold.set(640);
        fixture.detectChanges();
        flushScheduledChecks();
        host.loads = 0;

        setScrollMetrics(200, 1000, 120); // 680 px left: outside
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(0);

        setScrollMetrics(300, 1000, 120); // 580 px left: two rows ahead
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
        expect(host.loads).toBe(1);
    });

    it('drops a pending load when the list is replaced before it runs', async () => {
        flushScheduledChecks();
        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        host.loads = 0;

        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        host.resetKey.set('b');
        fixture.detectChanges();
        await nextTask();

        expect(host.loads).toBe(0);
    });

    it('lets a fill-check load answer a scroll that crossed the threshold meanwhile', async () => {
        flushScheduledChecks();
        setScrollMetrics(500);
        scrollHost.dispatchEvent(new Event('scroll'));
        host.loads = 0;

        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        host.itemCount.set(14); // a re-render schedules a fill check
        fixture.detectChanges();
        flushScheduledChecks();
        expect(host.loads).toBe(1);
        await nextTask();

        expect(host.loads).toBe(1);
    });

    it('does not emit on scroll while appending or when nothing more exists', async () => {
        flushScheduledChecks();
        host.loads = 0;

        host.appending.set(true);
        fixture.detectChanges();
        setScrollMetrics(700);
        scrollHost.dispatchEvent(new Event('scroll'));
        await nextTask();
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
        await nextTask();
        expect(host.loads).toBe(0);
    });

    it('auto-fills when the container does not overflow the viewport', () => {
        // JSDOM default geometry (all zeros) models an unfilled container.
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();

        expect(host.loads).toBe(1);
    });

    it('keeps auto-filling while loads grow the container, until it overflows', () => {
        // A huge viewport: many chunks fit before a scrollbar appears. The
        // auto-fill must not stop at an arbitrary load budget — only overflow
        // (or lack of progress) may end it, or the tail stays unreachable.
        let contentHeight = 0;
        setScrollMetrics(0, contentHeight, 5000);
        flushScheduledChecks();
        expect(host.loads).toBe(1);

        for (let round = 0; round < 14; round++) {
            contentHeight += 300;
            setScrollMetrics(0, contentHeight, 5000);
            host.itemCount.update((count) => count + 14);
            fixture.detectChanges();
            flushScheduledChecks();
        }
        expect(host.loads).toBe(15);

        // The container finally overflows past the threshold — no more
        // self-initiated loads; scrolling takes over from here.
        setScrollMetrics(0, 6000, 5000);
        host.itemCount.update((count) => count + 14);
        fixture.detectChanges();
        flushScheduledChecks();
        expect(host.loads).toBe(15);
    });

    it('stops auto-filling after consecutive loads without container growth', () => {
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();
        expect(host.loads).toBe(1);

        // Each "append" changes the item count but never grows the container
        // — a degenerate source; the stall guard ends the loop.
        for (let round = 0; round < 20; round++) {
            host.itemCount.update((count) => count + 14);
            fixture.detectChanges();
            flushScheduledChecks();
        }

        expect(host.loads).toBe(3);
    });

    it('resets the stall guard when the reset key changes', () => {
        setScrollMetrics(0, 0, 0);
        flushScheduledChecks();
        for (let round = 0; round < 20; round++) {
            host.itemCount.update((count) => count + 14);
            fixture.detectChanges();
            flushScheduledChecks();
        }
        expect(host.loads).toBe(3);

        host.resetKey.set('b');
        fixture.detectChanges();
        flushScheduledChecks();

        expect(host.loads).toBe(4);
    });

    it('clears a stale near-end latch when appended content moves the bottom away', async () => {
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
        await nextTask();
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
