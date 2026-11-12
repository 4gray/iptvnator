import { SecondStreamFloatingDirective } from './second-stream-floating.directive';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    OnDestroy,
    signal,
    viewChild,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { SecondStreamPickerComponent } from './second-stream-picker.component';
import { SecondStreamPosition } from './second-stream-position';
import { handoffMpvAudio } from '../embedded-mpv-player/embedded-mpv-audio-handoff';

@Component({
    selector: 'app-second-stream',
    templateUrl: './second-stream.component.html',
    styleUrl: './second-stream.component.scss',
    imports: [
        SecondStreamFloatingDirective,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
        SecondStreamPickerComponent,
        EmbeddedMpvPlayerComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecondStreamComponent implements OnDestroy {
    readonly primary = input.required<EmbeddedMpvPlayerComponent>();
    readonly fullscreenTarget = input<HTMLElement | null>(null);
    readonly secondary = viewChild(EmbeddedMpvPlayerComponent);
    readonly playback = signal<ResolvedPortalPlayback | null>(null);
    readonly active = computed(() => this.playback() !== null);
    readonly swapped = signal(false);
    readonly busy = signal(false);
    readonly editing = signal(false);
    readonly error = signal(false);
    readonly available = computed(
        () => this.primary().support()?.engine === 'frame-copy'
    );
    readonly small = computed(() =>
        this.swapped() ? this.primary() : this.secondary()
    );
    readonly ready = computed(() =>
        Boolean(
            this.primary().controller.sessionId() &&
            this.secondary()?.controller.sessionId()
        )
    );
    private readonly abort = new AbortController();
    readonly audibleVolume = signal(1);
    readonly placement = new SecondStreamPosition();
    readonly resizeCorners = ['left', 'right'] as const;

    constructor() {
        effect((cleanup) => {
            const stage = this.fullscreenTarget();
            if (!stage) return;
            const measure = () =>
                untracked(() =>
                    this.placement.measure(
                        stage.getBoundingClientRect(),
                        {
                            width: window.innerWidth,
                            height: window.innerHeight,
                        },
                        document.fullscreenElement === stage
                    )
                );
            const observer = new ResizeObserver(measure);
            observer.observe(stage);
            window.addEventListener('resize', measure);
            document.addEventListener('fullscreenchange', measure);
            measure();
            cleanup(() => {
                observer.disconnect();
                window.removeEventListener('resize', measure);
                document.removeEventListener('fullscreenchange', measure);
            });
        });
        effect(() => {
            if (this.busy()) return;
            const session = (
                this.swapped() ? this.secondary() : this.primary()
            )?.session();
            if (
                (session?.status === 'playing' ||
                    session?.status === 'paused') &&
                (!this.error() || session.volume > 0)
            ) {
                this.audibleVolume.set(session.volume);
            }
        });
    }

    async selectPlayback(playback: ResolvedPortalPlayback): Promise<void> {
        if (!this.editing() || this.busy() || !this.available()) return;
        this.editing.set(false);
        if (this.swapped() && !(await this.swap())) {
            this.error.set(true);
            return;
        }
        if (this.abort.signal.aborted) return;
        this.playback.set(playback);
        this.error.set(false);
    }

    async swap(): Promise<boolean> {
        if (this.busy() || !this.ready()) return false;
        const outgoing = this.swapped() ? this.secondary() : this.primary();
        const incoming = this.swapped() ? this.primary() : this.secondary();
        const from = outgoing?.controller.sessionId();
        const to = incoming?.controller.sessionId();
        if (!from || !to) return false;
        this.busy.set(true);
        if (!this.error())
            this.audibleVolume.set(
                outgoing?.session()?.volume ?? this.audibleVolume()
            );
        this.error.set(false);
        try {
            await handoffMpvAudio(
                window.electron,
                from,
                to,
                this.audibleVolume(),
                this.abort.signal
            );
            if (this.abort.signal.aborted) return false;
            this.swapped.update((value) => !value);
            return true;
        } catch {
            if (!this.abort.signal.aborted) this.error.set(true);
            return false;
        } finally {
            this.busy.set(false);
        }
    }

    async close(): Promise<void> {
        if (this.busy()) return;
        if (this.swapped()) await this.swap();
        this.swapped.set(false);
        this.playback.set(null);
    }

    pauseSmall(): void {
        void this.small()?.controller.togglePaused();
    }

    ngOnDestroy(): void {
        this.abort.abort();
    }
}
