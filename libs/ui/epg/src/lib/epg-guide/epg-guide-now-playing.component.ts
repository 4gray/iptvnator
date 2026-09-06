import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    OnDestroy,
    OnInit,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { getProgramTimeMs } from '../epg-program.utils';

/**
 * Info block of the docked player strip while the guide is open: channel,
 * current programme, progress, Close and Collapse. The host renders it next to
 * the player because the strip itself is host layout.
 */
@Component({
    selector: 'app-epg-guide-now-playing',
    imports: [DatePipe, MatButtonModule, TranslatePipe],
    templateUrl: './epg-guide-now-playing.component.html',
    styleUrl: './epg-guide-now-playing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideNowPlayingComponent implements OnInit, OnDestroy {
    readonly channelName = input('');
    readonly program = input<EpgProgram | null>(null);
    readonly offsetMinutes = input(0);
    readonly collapsed = input(false);
    /**
     * Whether the strip offers its Collapse/Expand toggle. False where the
     * strip is already at its minimum — the external-player dock has no video
     * to collapse away, so the button would only write a preference the user
     * cannot see the effect of.
     */
    readonly collapsible = input(true);

    readonly closeRequested = output<void>();
    readonly collapsedChange = output<boolean>();

    private readonly nowMs = signal(Date.now());
    private timer?: number;

    readonly startMs = computed(() => this.boundary('start'));
    readonly stopMs = computed(() => this.boundary('stop'));
    readonly isOnNow = computed(() => {
        const start = this.startMs();
        const stop = this.stopMs();
        const now = this.nowMs();
        return start !== null && stop !== null && start <= now && now < stop;
    });
    readonly progress = computed(() => {
        const start = this.startMs();
        const stop = this.stopMs();
        if (start === null || stop === null || stop <= start) {
            return null;
        }
        const pct = ((this.nowMs() - start) / (stop - start)) * 100;
        return Math.min(100, Math.max(0, pct));
    });

    ngOnInit(): void {
        this.timer = window.setInterval(
            () => this.nowMs.set(Date.now()),
            30_000
        );
    }

    ngOnDestroy(): void {
        window.clearInterval(this.timer);
    }

    private boundary(edge: 'start' | 'stop'): number | null {
        const program = this.program();
        if (!program) {
            return null;
        }
        const ms = getProgramTimeMs(
            program[edge],
            edge === 'start' ? program.startTimestamp : program.stopTimestamp,
            this.offsetMinutes()
        );
        return Number.isFinite(ms) ? ms : null;
    }
}
