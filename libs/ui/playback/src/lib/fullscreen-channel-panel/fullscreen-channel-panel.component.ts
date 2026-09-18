import { OverlayContainer } from '@angular/cdk/overlay';
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
 * without a provider (VOD detail pages, series) nothing renders. The view
 * can also switch it off through `enabled` for an engine that paints above
 * the DOM (native-view Embedded MPV), where no DOM panel could show.
 *
 * Nothing is drawn over the video while the panel is closed and the pointer
 * rests. Moving the mouse over the stage reveals a slim hint tab on the left
 * edge (it fades with the rest of the chrome once the pointer goes idle), and
 * opening is resting the mouse on that edge, clicking or tapping it, or
 * pressing `C`. Closing: moving the mouse away after it has been inside the
 * panel, clicking the video (a scrim swallows that click so it never pauses
 * playback), the close button, Escape, or leaving fullscreen. A panel opened
 * with `C` ignores the mouse roaming over the video until it has visited the
 * list, so the key never leaves the user typing into a closing search field.
 * A CDK overlay opened from the list (sort menu, row context menu) counts as
 * part of the panel: the pointer moving into it does not start the close, and
 * Escape closes that overlay first. The list stays mounted between openings
 * of one fullscreen session so its scroll position and search survive.
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
    private readonly overlayContainer = inject(OverlayContainer);

    /** Element whose DOM fullscreen the panel lives in. */
    readonly stage = input<HTMLElement | null>(null);
    /**
     * False while the rendered engine cannot show DOM content over its video
     * (native-view Embedded MPV paints a platform view above the page): every
     * affordance disappears, exactly like outside fullscreen.
     */
    readonly enabled = input(true);
    readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');
    private readonly panelElement = viewChild<ElementRef<HTMLElement>>('panel');
    private readonly hotZoneElement =
        viewChild<ElementRef<HTMLElement>>('hotZone');

    readonly state = new FullscreenChannelPanelState();
    readonly searchTerm = signal('');
    private readonly fullscreen = new ControlsFullscreen(
        () => this.stage(),
        () => this.onFullscreenChanged()
    );

    readonly isFullscreen = this.fullscreen.isFullscreen;
    readonly template = computed(() => this.panelHost?.panelTemplate() ?? null);
    /**
     * The host's context label (playlist or category name). It carries no row
     * of its own: the search field's placeholder reads "Search in <title>".
     */
    readonly panelTitle = computed(
        () => this.panelHost?.panelTitle?.()?.trim() ?? ''
    );
    /** Every affordance exists only in fullscreen and only with a host list. */
    readonly active = computed(
        () => this.enabled() && this.isFullscreen() && this.template() !== null
    );
    readonly context: FullscreenChannelPanelContext = {
        searchTerm: this.searchTerm.asReadonly(),
        close: () => this.state.hide(),
    };

    /** Pointer whose primary press began inside the hot zone, if any. */
    private hotZonePressPointerId: number | null = null;

    private readonly onDocumentKeydown = (event: KeyboardEvent) =>
        this.handleKeydown(event);

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.onDocumentKeydown);
        }
        effect(() => {
            this.stage();
            this.fullscreen.sync();
        });
        effect(() => {
            if (this.active()) {
                return;
            }
            untracked(() => this.resetSession());
        });
        // The edge hint follows pointer activity over the stage, the element
        // that owns fullscreen: any mouse movement over the video reveals it.
        effect((onCleanup) => {
            const stage = this.stage();
            if (!this.active() || !stage) {
                return;
            }
            const onPointerMove = (event: PointerEvent) => {
                if (event.pointerType !== 'touch') {
                    this.state.stageActivity();
                }
            };
            stage.addEventListener('pointermove', onPointerMove, {
                passive: true,
            });
            onCleanup(() =>
                stage.removeEventListener('pointermove', onPointerMove)
            );
        });
        // While open, hover intent is tracked document-wide: a CDK overlay the
        // list opens (sort menu, context menu) renders outside the <aside>, so
        // the aside's own pointerleave alone would close the panel under the
        // menu, and nothing would close it once the pointer left that menu.
        effect((onCleanup) => {
            if (!this.state.open() || typeof document === 'undefined') {
                return;
            }
            const onPointerOver = (event: PointerEvent) =>
                this.onDocumentPointerOver(event);
            document.addEventListener('pointerover', onPointerOver);
            onCleanup(() =>
                document.removeEventListener('pointerover', onPointerOver)
            );
        });
    }

    ngOnDestroy(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', this.onDocumentKeydown);
        }
        this.fullscreen.dispose();
        this.state.dispose();
    }

    onHotZoneEnter(event: PointerEvent): void {
        // Hover intent is a mouse concept; touch opens on the tap instead.
        if (event.pointerType === 'touch') {
            return;
        }
        this.state.hotZoneEnter();
    }

    /**
     * A click or tap on the edge opens at once, without the hover dwell:
     * touch has no hover and no `C` key, and a mouse user who has found the
     * hint tab should not have to hold still. Only a primary press that
     * began inside the zone counts: a drag released over the edge, a right
     * or middle click and a pen barrel button are not a click. Completed on
     * pointerup, not pointerdown: the hot zone must still be the click
     * target when the press completes, so the click that follows dies on it
     * instead of reaching the video's click-to-pause.
     */
    onHotZonePointerDown(event: PointerEvent): void {
        this.hotZonePressPointerId =
            event.button === 0 ? event.pointerId : null;
    }

    onHotZonePointerUp(event: PointerEvent): void {
        const pressed = this.hotZonePressPointerId;
        this.hotZonePressPointerId = null;
        if (pressed === null || pressed !== event.pointerId) {
            return;
        }
        this.state.show('pointer');
    }

    onHotZoneLeave(): void {
        this.hotZonePressPointerId = null;
        this.state.hotZoneLeave();
    }

    onPanelPointerEnter(event: PointerEvent): void {
        if (event.pointerType === 'touch') {
            return;
        }
        this.state.panelEnter();
    }

    onPanelPointerLeave(event: PointerEvent): void {
        if (
            event.pointerType === 'touch' ||
            this.isInsideOverlay(event.relatedTarget)
        ) {
            return;
        }
        this.state.panelLeave();
    }

    onSearchInput(event: Event): void {
        this.searchTerm.set((event.target as HTMLInputElement).value);
    }

    clearSearch(): void {
        this.searchTerm.set('');
        this.searchInput()?.nativeElement.focus({ preventScroll: true });
    }

    private onDocumentPointerOver(event: PointerEvent): void {
        if (event.pointerType === 'touch') {
            return;
        }
        if (
            this.isInsidePanel(event.target) ||
            this.isInsideHotZone(event.target) ||
            this.isInsideOverlay(event.target)
        ) {
            this.state.panelEnter();
        } else {
            this.state.panelLeave();
        }
    }

    private isInsideHotZone(target: EventTarget | null): boolean {
        const hotZone = this.hotZoneElement()?.nativeElement;
        return (
            hotZone !== undefined &&
            target instanceof Node &&
            hotZone.contains(target)
        );
    }

    private isInsidePanel(target: EventTarget | null): boolean {
        const panel = this.panelElement()?.nativeElement;
        return (
            panel !== undefined &&
            target instanceof Node &&
            panel.contains(target)
        );
    }

    private isInsideOverlay(target: EventTarget | null): boolean {
        return (
            target instanceof Node &&
            this.overlayContainer.getContainerElement().contains(target)
        );
    }

    /** A menu or dialog is up: Escape belongs to it, not to the panel. */
    private hasModalOverlay(): boolean {
        return (
            this.overlayContainer
                .getContainerElement()
                .querySelector('.cdk-overlay-backdrop') !== null
        );
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
            if (this.state.open() && !this.hasModalOverlay()) {
                // Consume the key: Electron exits HTML fullscreen on an
                // unhandled Escape, and the advertised close shortcut must
                // only slide the panel away, not end the session with it.
                // A closed panel leaves Escape alone, so it still exits
                // fullscreen then; an overlay-owned Escape is untouched too.
                event.preventDefault();
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
        this.state.show('keyboard');
        this.focusSearch();
    }

    /** A keyboard opening lands in the search field; hover does not steal focus. */
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
