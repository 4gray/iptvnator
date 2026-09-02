import { NgTemplateOutlet } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ControlsFullscreen } from '../player-controls/controls-fullscreen';
import { ControlsVisibility } from '../player-controls/controls-visibility';
import { FullscreenChannelPanelState } from './fullscreen-channel-panel-state';
import {
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
} from './fullscreen-channel-panel.model';

const EDITABLE_SELECTOR =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function targetsEditable(event: KeyboardEvent): boolean {
    const path =
        typeof event.composedPath === 'function'
            ? event.composedPath()
            : [event.target];
    return path.some(
        (node) =>
            node instanceof Element &&
            (node.matches(EDITABLE_SELECTOR) ||
                (node as HTMLElement).isContentEditable === true)
    );
}

/**
 * Slide-in channel list for fullscreen playback.
 *
 * Rendered by `WebPlayerViewComponent` beside the engine, inside the element
 * that owns DOM fullscreen, so the list stays visible while the video is
 * fullscreen and survives the engine remount a channel switch causes. The
 * content comes from the host page through {@link FULLSCREEN_CHANNEL_PANEL};
 * without a provider (VOD detail pages, series) nothing renders.
 *
 * Opening: resting the mouse on the left edge, clicking the edge handle, or
 * pressing `C`. Closing: moving the mouse away, clicking the video (a scrim
 * swallows that click so it never pauses playback), the close button,
 * Escape, or leaving fullscreen. The list stays mounted between openings of
 * one fullscreen session so its scroll position and search survive.
 */
@Component({
    selector: 'app-fullscreen-channel-panel',
    templateUrl: './fullscreen-channel-panel.component.html',
    styleUrl: './fullscreen-channel-panel.component.scss',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        NgTemplateOutlet,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    // The host template's nodes carry the host's style attribute, not this
    // component's, so the body sizing rules must reach them unscoped.
    encapsulation: ViewEncapsulation.None,
    host: { class: 'fullscreen-channel-panel-host' },
})
export class FullscreenChannelPanelComponent implements OnDestroy {
    private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
    private readonly panelHost = inject(FULLSCREEN_CHANNEL_PANEL, {
        optional: true,
    });

    /** Element whose DOM fullscreen the panel lives in. */
    readonly stage = input<HTMLElement | null>(null);
    readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    readonly state = new FullscreenChannelPanelState();
    readonly searchTerm = signal('');
    private readonly fullscreen = new ControlsFullscreen(
        () => this.stage(),
        () => this.onFullscreenChanged()
    );
    // The edge handle follows the same reveal/auto-hide rhythm as the controls
    // bar, driven by pointer activity on the stage. It is never hidden while
    // the panel is open (it is not rendered then either).
    private readonly handleVisibility = new ControlsVisibility(
        () => !this.state.open()
    );

    readonly isFullscreen = this.fullscreen.isFullscreen;
    readonly handleVisible = this.handleVisibility.visible;
    readonly template = computed(() => this.panelHost?.panelTemplate() ?? null);
    readonly panelTitle = computed(
        () => this.panelHost?.panelTitle?.()?.trim() ?? ''
    );
    /** Every affordance exists only in fullscreen and only with a host list. */
    readonly active = computed(
        () => this.isFullscreen() && this.template() !== null
    );
    readonly context: FullscreenChannelPanelContext = {
        searchTerm: this.searchTerm.asReadonly(),
        close: () => this.state.hide(),
    };

    private readonly onDocumentKeydown = (event: KeyboardEvent) =>
        this.handleKeydown(event);

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.onDocumentKeydown);
        }
        effect((onCleanup) => {
            const stage = this.stage();
            this.fullscreen.sync();
            if (!stage) {
                return;
            }
            onCleanup(this.attachStage(stage));
        });
        effect(() => {
            if (this.active()) {
                return;
            }
            untracked(() => this.resetSession());
        });
        effect(() => {
            const open = this.state.open();
            untracked(() => {
                if (open) {
                    this.handleVisibility.clear();
                } else {
                    this.handleVisibility.reveal();
                }
            });
        });
    }

    ngOnDestroy(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', this.onDocumentKeydown);
        }
        this.fullscreen.dispose();
        this.handleVisibility.dispose();
        this.state.dispose();
    }

    onHotZoneEnter(event: PointerEvent): void {
        // Hover intent is a mouse concept: a finger landing on the edge is a
        // tap on the video, not a request for the list.
        if (event.pointerType === 'touch') {
            return;
        }
        this.state.hotZoneEnter();
    }

    onPanelPointerEnter(event: PointerEvent): void {
        if (event.pointerType === 'touch') {
            return;
        }
        this.state.panelEnter();
    }

    onPanelPointerLeave(event: PointerEvent): void {
        if (event.pointerType === 'touch') {
            return;
        }
        this.state.panelLeave();
    }

    openFromHandle(): void {
        this.state.show();
        this.focusSearch();
    }

    onSearchInput(event: Event): void {
        this.searchTerm.set((event.target as HTMLInputElement).value);
    }

    clearSearch(): void {
        this.searchTerm.set('');
        this.searchInput()?.nativeElement.focus({ preventScroll: true });
    }

    private attachStage(stage: HTMLElement): () => void {
        const reveal = (event: PointerEvent) => {
            // Touch has no hover: only a tap reveals the handle, a synthesized
            // pointermove must not keep it alive.
            if (event.pointerType === 'touch' && event.type !== 'pointerdown') {
                return;
            }
            this.handleVisibility.reveal();
        };
        stage.addEventListener('pointermove', reveal, { passive: true });
        stage.addEventListener('pointerdown', reveal, { passive: true });
        return () => {
            stage.removeEventListener('pointermove', reveal);
            stage.removeEventListener('pointerdown', reveal);
        };
    }

    private onFullscreenChanged(): void {
        if (!this.isFullscreen()) {
            this.resetSession();
        }
    }

    private resetSession(): void {
        this.state.reset();
        this.searchTerm.set('');
    }

    private handleKeydown(event: KeyboardEvent): void {
        if (!this.active()) {
            return;
        }
        if (event.key === 'Escape') {
            if (this.state.open()) {
                this.state.hide();
            }
            return;
        }
        if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            (event.key !== 'c' && event.key !== 'C')
        ) {
            return;
        }
        // Typing into any field (the panel's own search included) and a
        // player behind a modal surface keep the key.
        if (targetsEditable(event) || this.host.closest('[inert]')) {
            return;
        }
        event.preventDefault();
        if (this.state.open()) {
            this.state.hide();
            return;
        }
        this.state.show();
        this.focusSearch();
    }

    /** Keyboard and handle openings land in the search field; hover does not steal focus. */
    private focusSearch(): void {
        window.setTimeout(() => {
            if (this.state.open()) {
                this.searchInput()?.nativeElement.focus({
                    preventScroll: true,
                });
            }
        }, 0);
    }
}
