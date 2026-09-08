import { NgTemplateOutlet } from '@angular/common';
import {
    afterNextRender,
    Component,
    ElementRef,
    Injector,
    computed,
    contentChild,
    effect,
    inject,
    input,
    output,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { ContentHeroComponent } from '../content-hero/content-hero.component';
import { ContentAboutComponent } from './content-about.component';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
} from './detail-template.directives';

/**
 * Two-state layout shell for portal VOD/series detail pages.
 *
 * Browse state: hero (poster + metadata + actions) on top, episodes below.
 * Watch state (`playbackActive`): the hero collapses, the host-projected
 * player takes the full content width, and the metadata reappears in an
 * About block below the episodes slot.
 *
 * The shell owns the page scroll, the browse↔watch animation, Escape
 * handling, and never conditionally wraps the `[detail-player]` slot — the
 * host's own `@if (inlinePlayback())` is the only thing that creates or
 * destroys the player, so shell state changes cannot recreate it.
 */
@Component({
    selector: 'app-portal-detail-shell',
    standalone: true,
    imports: [
        ContentHeroComponent,
        ContentAboutComponent,
        NgTemplateOutlet,
        MatIconModule,
        TranslateModule,
    ],
    templateUrl: './portal-detail-shell.component.html',
    styleUrls: ['./portal-detail-shell.component.scss'],
    host: {
        tabindex: '0',
        role: 'region',
        '[attr.aria-label]': 'title() || backLabel()',
        '(keydown)': 'onScrollKey($event)',
        '[class.shell-host--watch]': 'isWatch()',
        '(document:keydown.escape)': 'onEscape($event)',
    },
})
export class PortalDetailShellComponent {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    private readonly backButton =
        viewChild<ElementRef<HTMLButtonElement>>('backButton');

    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();
    readonly backLabel = input<string>();
    /** False for hosts whose browse state has no parent navigation. */
    readonly backAvailable = input(true);
    /** True while inline playback is active — flips the layout to watch state. */
    readonly playbackActive = input(false);

    readonly backClicked = output<void>();
    /** Emitted by the sticky control or Escape during inline playback. */
    readonly closePlayerRequested = output<void>();

    protected readonly tagsTemplate = contentChild(DetailTagsTemplateDirective);
    protected readonly metaTemplate = contentChild(DetailMetaTemplateDirective);
    protected readonly actionsTemplate = contentChild(
        DetailActionsTemplateDirective
    );

    readonly isWatch = computed(() => this.playbackActive());

    constructor() {
        afterNextRender(() => {
            const element = this.host.nativeElement;
            const active = element.ownerDocument.activeElement;
            if (
                !this.playbackActive() &&
                !element.closest('[inert]') &&
                (active === element.ownerDocument.body ||
                    active === element.closest('main'))
            ) {
                element.focus({ preventScroll: true });
            }
        });
        let wasWatch = false;
        effect(() => {
            const watch = this.isWatch();
            if (watch && !wasWatch) {
                this.scrollToTop();
            }
            wasWatch = watch;
        });
    }

    onScrollKey(event: KeyboardEvent): void {
        if (
            event.target === this.host.nativeElement &&
            [
                'ArrowUp',
                'ArrowDown',
                'PageUp',
                'PageDown',
                'Home',
                'End',
                ' ',
            ].includes(event.key) &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
        ) {
            // Keep native page scrolling; a mounted player's global shortcuts
            // must not turn this into volume adjustment or pause.
            event.stopPropagation();
        }
    }

    onEscape(event: Event): void {
        const keyboard = event as KeyboardEvent;
        const element = this.host.nativeElement;
        const document = element.ownerDocument;
        if (
            event.defaultPrevented ||
            keyboard.repeat ||
            keyboard.altKey ||
            keyboard.ctrlKey ||
            keyboard.metaKey ||
            keyboard.shiftKey
        )
            return;
        if (!this.playbackActive() && !this.backAvailable()) return;
        if (
            element.closest('[inert], [hidden], [aria-hidden="true"]') ||
            element.checkVisibility?.({ checkVisibilityCSS: true }) === false
        )
            return;
        // Browser fullscreen owns Escape (exits fullscreen first).
        if (document.fullscreenElement) return;
        const target = event.target as HTMLElement | null;
        // Browse navigation belongs to the focused detail. Watch retains its
        // existing global close shortcut (M3U selection keeps sidebar focus).
        if (!target || (!this.playbackActive() && !element.contains(target)))
            return;
        if (
            target.isContentEditable ||
            target.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
            )
        )
            return;
        // Menus may keep focus on their trigger. Their own Escape listener
        // closes them; do not also dismiss the page/player behind them.
        const overlaySelector =
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
        if (
            event
                .composedPath()
                .some(
                    (node) =>
                        node instanceof Element && node.matches(overlaySelector)
                )
        )
            return;
        if (document.querySelector('.cdk-overlay-backdrop')) return;
        if (
            Array.from(
                document.querySelectorAll<HTMLElement>(overlaySelector)
            ).some(
                (overlay) =>
                    !overlay.closest(
                        '[hidden], [inert], [aria-hidden="true"]'
                    ) &&
                    overlay.checkVisibility?.({ checkVisibilityCSS: true }) !==
                        false
            )
        )
            return;
        event.preventDefault();
        this.onBack();
    }

    onBack(): void {
        if (!this.playbackActive()) {
            if (this.backAvailable()) this.backClicked.emit();
            return;
        }
        this.closePlayerRequested.emit();
        afterNextRender(
            () => {
                const element = this.host.nativeElement;
                if (
                    element.isConnected &&
                    !element.closest('[inert]') &&
                    element.ownerDocument.activeElement ===
                        element.ownerDocument.body
                ) {
                    (this.backButton()?.nativeElement ?? element).focus({
                        preventScroll: true,
                    });
                }
            },
            { injector: this.injector }
        );
    }

    private scrollToTop(): void {
        const element = this.host.nativeElement;
        // Instant jump: a smooth scroll would run concurrently with the
        // 300ms hero-collapse morph (a layout animation) and the two
        // animations fight for frame budget. The morph visually covers the
        // jump anyway.
        if (typeof element.scrollTo !== 'function') {
            element.scrollTop = 0;
            return;
        }
        element.scrollTo({ top: 0, behavior: 'auto' });
    }
}
