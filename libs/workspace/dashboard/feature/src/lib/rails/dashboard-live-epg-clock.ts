import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { LIVE_EPG_TICK_MS } from './dashboard-live-epg.utils';

/**
 * The dashboard's live-EPG wall clock: one heartbeat shared by the XMLTV
 * batch, the portal queue and every progress bar on the page.
 *
 * It only runs while a consumer has a live card to keep current and while
 * the document is visible. A dashboard without live cards, or one behind a
 * hidden tab or window, therefore schedules nothing. Starting again reads
 * the clock at once, so progress and "now on air" catch up the moment the
 * page is back in view instead of up to one period later.
 *
 * Component-provided, so the heartbeat dies with the dashboard.
 */
@Injectable()
export class DashboardLiveEpgClock {
    private readonly document = inject(DOCUMENT);
    private readonly demands = signal<readonly Signal<boolean>[]>([]);
    private readonly visible = signal(!this.document.hidden);
    private readonly nowMs = signal(Date.now());
    private readonly running = computed(
        () => this.visible() && this.demands().some((demand) => demand())
    );
    private timer: ReturnType<typeof setInterval> | null = null;

    /** Wall-clock ms of the latest tick. */
    readonly now: Signal<number> = this.nowMs.asReadonly();

    constructor() {
        const onVisibilityChange = () =>
            this.visible.set(!this.document.hidden);
        this.document.addEventListener('visibilitychange', onVisibilityChange);
        effect(() => {
            const running = this.running();
            untracked(() => (running ? this.start() : this.stop()));
        });
        inject(DestroyRef).onDestroy(() => {
            this.stop();
            this.document.removeEventListener(
                'visibilitychange',
                onVisibilityChange
            );
        });
    }

    /** Keeps the clock running for as long as `active` reads true. */
    demand(active: Signal<boolean>): void {
        this.demands.update((demands) => [...demands, active]);
    }

    private start(): void {
        if (this.timer !== null) return;
        this.nowMs.set(Date.now());
        this.timer = setInterval(
            () => this.nowMs.set(Date.now()),
            LIVE_EPG_TICK_MS
        );
    }

    private stop(): void {
        if (this.timer === null) return;
        clearInterval(this.timer);
        this.timer = null;
    }
}
