import { SecondStreamFloatingDirective } from './second-stream-floating.directive';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    inject,
    OnDestroy,
    output,
    signal,
    viewChild,
    untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { RecordingStoppedEvent } from '@iptvnator/shared/interfaces';
import {
    SecondStreamCatalogService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
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
    readonly recordingStopped = output<RecordingStoppedEvent>();
    readonly secondary = viewChild(EmbeddedMpvPlayerComponent);
    private readonly catalog = inject(SecondStreamCatalogService);
    readonly selection = signal<SecondStreamSelection | null>(null);
    private readonly relocking = signal(false);
    readonly playback = computed(() => {
        const selection = this.selection();
        return selection &&
            !this.relocking() &&
            this.catalog.isAllowed(selection.item)
            ? selection.playback
            : null;
    });
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
            if (!this.selection() || this.active()) return;
            this.relocking.set(true);
            if (!this.busy()) untracked(() => void this.stopWithheldStream());
        });
        effect(() => {
            if (this.busy() || this.relocking()) return;
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

    async selectPlayback(selection: SecondStreamSelection): Promise<void> {
        if (
            !this.editing() ||
            this.busy() ||
            this.relocking() ||
            !this.available()
        )
            return;
        if (!this.catalog.isAllowed(selection.item)) return;
        this.editing.set(false);
        if (this.swapped() && !(await this.swap())) {
            this.error.set(true);
            return;
        }
        if (
            this.abort.signal.aborted ||
            !this.catalog.isAllowed(selection.item)
        )
            return;
        this.selection.set(selection);
        this.error.set(false);
    }

    async swap(): Promise<boolean> {
        const canContinue = () => !this.abort.signal.aborted && this.active();
        if (this.busy() || !this.ready() || !canContinue()) return false;
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
                canContinue
            );
            if (!canContinue()) return false;
            this.swapped.update((value) => !value);
            return true;
        } catch {
            if (canContinue()) this.error.set(true);
            return false;
        } finally {
            this.busy.set(false);
        }
    }

    private async stopWithheldStream(): Promise<void> {
        this.busy.set(true);
        const secondaryId = this.secondary()?.controller.sessionId();
        let muted = false;
        if (secondaryId) {
            try {
                await window.electron.setEmbeddedMpvVolume(secondaryId, 0);
                muted = true;
            } catch {
                // Without a mute acknowledgement, leave the primary volume alone.
            }
        }
        this.selection.set(null);
        this.swapped.set(false);
        this.relocking.set(false);
        if (muted && !this.abort.signal.aborted)
            await this.restorePrimaryAudio();
        this.busy.set(false);
    }

    private async restorePrimaryAudio(): Promise<void> {
        const id = this.primary().controller.sessionId();
        if (id) {
            await window.electron
                .setEmbeddedMpvVolume(id, this.audibleVolume())
                .catch(() => undefined);
        }
    }

    async close(): Promise<void> {
        if (this.busy()) return;
        if (this.swapped()) await this.swap();
        if (this.selection() && !this.active()) return;
        this.swapped.set(false);
        this.selection.set(null);
    }

    pauseSmall(): void {
        void this.small()?.controller.togglePaused();
    }

    ngOnDestroy(): void {
        this.abort.abort();
    }
}
