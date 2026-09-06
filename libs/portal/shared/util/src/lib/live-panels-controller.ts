import {
    computed,
    ElementRef,
    inject,
    Signal,
    untracked,
} from '@angular/core';
import { handoffFocusOnLiveSidebarChange } from './focus-handoff';
import { LIVE_CATEGORIES_POPOVER } from './live-categories-popover.token';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import { LiveSidebarState, LiveSidebarSurface } from './live-sidebar-state';

export interface LivePanelsControllerOptions {
    /** The surface whose per-surface state this layout renders. */
    readonly surface: LiveSidebarSurface;
    /**
     * A live category is selected, so the layout renders a channels rail
     * whose header can host the category dropdown and the show-categories
     * button. Mirrors the shell's fold rule: on the live root the categories
     * rail stays visible at `categories-hidden`.
     */
    readonly hasSelectedCategory: Signal<boolean>;
    /** The header's show-categories button, once rendered. */
    readonly showCategoriesButton: Signal<ElementRef<HTMLElement> | undefined>;
    /** The floating restore handle, once rendered at player-only. */
    readonly restoreButton: Signal<ElementRef<HTMLElement> | undefined>;
}

/**
 * The live-TV panel behaviour shared by the Xtream and Stalker live layouts:
 * the nested fold levels read from `LiveLayoutSidebarStateService`, the
 * category dropdown bridge to the shell's `LIVE_CATEGORIES_POPOVER`, and the
 * focus handoff across level changes. Create it in a field initializer (an
 * injection context) with `createLivePanelsController()`.
 */
export class LivePanelsController {
    private readonly sidebarState = inject(LiveLayoutSidebarStateService);
    // Shell-provided; absent when no categories rail exists to fold (unit
    // tests, hosts outside the workspace shell), in which case the header
    // keeps its plain title.
    private readonly categoriesPopover = inject(LIVE_CATEGORIES_POPOVER, {
        optional: true,
    });

    /** Player only: the channels rail is folded (and `inert`). */
    readonly isSidebarCollapsed: Signal<boolean>;
    /** The header shows the category dropdown and show-categories button. */
    readonly canOpenCategoriesPopover: Signal<boolean>;
    /**
     * The level the layout actually shows. On the live root the categories
     * rail stays visible at `categories-hidden`, and the first category
     * selection folds it without a state change — the focus handoff keys on
     * this, not on the raw state.
     */
    readonly effectiveLevel: Signal<LiveSidebarState>;

    constructor(private readonly options: LivePanelsControllerOptions) {
        const surface = options.surface;
        this.isSidebarCollapsed = this.sidebarState.isCollapsedFor(surface);
        const categoriesHidden =
            this.sidebarState.areCategoriesHiddenFor(surface);
        this.canOpenCategoriesPopover = computed(
            () =>
                this.categoriesPopover !== null &&
                categoriesHidden() &&
                this.options.hasSelectedCategory()
        );
        this.effectiveLevel = computed(() =>
            this.isSidebarCollapsed()
                ? 'collapsed'
                : this.canOpenCategoriesPopover()
                  ? 'categories-hidden'
                  : 'expanded'
        );
        // Every level change inerts or removes the button the user activated
        // and drops focus to <body>; hand it to the affordance that replaces
        // it once the layout has rendered (see the helper's contract).
        handoffFocusOnLiveSidebarChange(this.effectiveLevel, (next) =>
            next === 'collapsed'
                ? untracked(this.options.restoreButton)?.nativeElement
                : next === 'categories-hidden'
                  ? untracked(this.options.showCategoriesButton)?.nativeElement
                  : null
        );
    }

    /** `Cmd/Ctrl+B` and the floating restore handle. */
    toggleSidebar(): void {
        this.sidebarState.toggle(this.options.surface);
    }

    /** The channels header chevron: player only. */
    collapsePanels(): void {
        this.sidebarState.collapse(this.options.surface);
    }

    /** Level 1. The shell knows whether the rail is a phone drawer. */
    showCategories(): void {
        if (this.categoriesPopover) {
            this.categoriesPopover.showCategoriesPanel();
            return;
        }
        this.sidebarState.showCategories(this.options.surface);
    }

    openCategoriesPopover(origin: HTMLElement): void {
        this.categoriesPopover?.open(origin);
    }
}

/** Must run in an injection context (a component field initializer). */
export function createLivePanelsController(
    options: LivePanelsControllerOptions
): LivePanelsController {
    return new LivePanelsController(options);
}
