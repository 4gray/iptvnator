import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlayerUpNextItem } from './player-controls.model';

/** How long the full card shows before it shrinks to a pill. */
export const UP_NEXT_COLLAPSE_DELAY_MS = 10_000;

/**
 * The "Up next" card in the player's bottom-right corner: thumbnail, the
 * time left, the next episode's label and title. One click plays it through
 * the host's ordinary next-episode path, so fullscreen survives. After a few
 * seconds of being seen (hovering pauses the count) it asks to collapse into
 * a pill, and the close button or Escape dismisses it for this episode.
 */
@Component({
    selector: 'app-player-up-next-card',
    templateUrl: './player-up-next-card.component.html',
    styleUrl: './player-up-next-card.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-up-next',
        '[class.player-up-next--compact]': 'compact()',
        '[class.player-up-next--collapsed]': 'collapsed()',
        '(mouseenter)': 'hovered.set(true)',
        '(mouseleave)': 'hovered.set(false)',
        '(keydown.escape)': 'onEscape($event)',
    },
})
export class PlayerUpNextCardComponent {
    readonly item = input.required<PlayerUpNextItem>();
    readonly remainingSeconds = input.required<number>();
    readonly compact = input(false);
    readonly collapsed = input(false);
    readonly selected = output<void>();
    readonly dismissed = output<void>();
    readonly collapseRequested = output<void>();

    readonly hovered = signal(false);
    /** Collapse delay still owed; hovering pauses it rather than resetting. */
    private collapseRemainingMs = UP_NEXT_COLLAPSE_DELAY_MS;
    /** The episode the owed delay belongs to; a new one starts afresh. */
    private collapseLabel: string | null = null;

    /** Whole seconds under a minute, otherwise whole minutes (at least 1). */
    readonly countdown = computed(() => {
        const seconds = Math.max(0, Math.ceil(this.remainingSeconds()));
        return seconds < 60
            ? {
                  key: 'EMBEDDED_MPV.PLAYER.UP_NEXT_IN_SECONDS',
                  params: { seconds },
              }
            : {
                  key: 'EMBEDDED_MPV.PLAYER.UP_NEXT_IN',
                  params: { minutes: Math.ceil(seconds / 60) },
              };
    });

    /** The still that failed to load; a new URL gets its own attempt. */
    private readonly failedThumbnail = signal<string | null>(null);
    readonly thumbnail = computed(() => {
        const url = this.item().thumbnailUrl;
        return url && url !== this.failedThumbnail() ? url : null;
    });

    constructor() {
        effect((onCleanup) => {
            const label = this.item().label;
            if (label !== this.collapseLabel) {
                this.collapseLabel = label;
                this.collapseRemainingMs = UP_NEXT_COLLAPSE_DELAY_MS;
            }
            if (this.collapsed() || this.hovered()) {
                return;
            }
            const startedAt = Date.now();
            const timer = setTimeout(
                () => this.collapseRequested.emit(),
                this.collapseRemainingMs
            );
            onCleanup(() => {
                clearTimeout(timer);
                this.collapseRemainingMs = Math.max(
                    0,
                    this.collapseRemainingMs - (Date.now() - startedAt)
                );
            });
        });
    }

    onThumbnailError(): void {
        this.failedThumbnail.set(this.item().thumbnailUrl);
    }

    /** Escape on the card closes it rather than reaching the player. */
    onEscape(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit();
    }
}
