import { NgTemplateOutlet } from '@angular/common';
import {
    Component,
    ElementRef,
    computed,
    contentChild,
    effect,
    inject,
    input,
    output,
} from '@angular/core';
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
    imports: [ContentHeroComponent, ContentAboutComponent, NgTemplateOutlet],
    templateUrl: './portal-detail-shell.component.html',
    styleUrls: ['./portal-detail-shell.component.scss'],
    host: {
        '[class.shell-host--watch]': 'isWatch()',
        '(document:keydown.escape)': 'onEscape($event)',
    },
})
export class PortalDetailShellComponent {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();
    /** True while inline playback is active — flips the layout to watch state. */
    readonly playbackActive = input(false);

    readonly backClicked = output<void>();
    /** Emitted when Escape is pressed during inline playback. */
    readonly closePlayerRequested = output<void>();

    protected readonly tagsTemplate = contentChild(DetailTagsTemplateDirective);
    protected readonly metaTemplate = contentChild(DetailMetaTemplateDirective);
    protected readonly actionsTemplate = contentChild(
        DetailActionsTemplateDirective
    );

    readonly isWatch = computed(() => this.playbackActive());

    constructor() {
        let wasWatch = false;
        effect(() => {
            const watch = this.isWatch();
            if (watch && !wasWatch) {
                this.scrollToTop();
            }
            wasWatch = watch;
        });
    }

    onEscape(event: KeyboardEvent): void {
        if (!this.playbackActive()) return;
        if (event.defaultPrevented) return;
        // Browser fullscreen owns Escape (exits fullscreen first).
        if (document.fullscreenElement) return;
        const target = event.target as HTMLElement | null;
        if (
            target &&
            (target.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        ) {
            return;
        }
        this.closePlayerRequested.emit();
    }

    private scrollToTop(): void {
        const element = this.host.nativeElement;
        if (typeof element.scrollTo !== 'function') {
            element.scrollTop = 0;
            return;
        }
        const reducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        element.scrollTo({
            top: 0,
            behavior: reducedMotion ? 'auto' : 'smooth',
        });
    }
}
