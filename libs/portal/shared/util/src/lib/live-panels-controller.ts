import {
    afterRenderEffect,
    computed,
    ElementRef,
    inject,
    Signal,
    untracked,
} from '@angular/core';
import {
    focusIfFocusLost,
    handoffFocusOnLiveSidebarChange,
} from './focus-handoff';
import { LIVE_CATEGORIES_POPOVER } from './live-categories-popover.token';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import { LiveSidebarState, LiveSidebarSurface } from './live-sidebar-state';

export interface LivePanelsControllerOptions {
    /** The surface whose per-surface state this layout renders. */
    readonly surface: LiveSidebarSurface;
    /** The header's show-categories button, once rendered. */
    readonly showCategoriesButton: Signal<ElementRef<HTMLElement> | undefined>;
    readonly categoryDropdownButton?: Signal<
        ElementRef<HTMLElement> | undefined
    >;
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
    /** The channels header shows the category dropdown and show-categories button. */
    readonly canOpenCategoriesPopover: Signal<boolean>;
    /**
     * The categories rail is folded while the channels rail is not, so a
     * layout without a channels header (the all-items views) has to offer the
     * way back itself.
     */
    readonly isCategoriesRailFolded: Signal<boolean>;
    /**
     * The level the layout actually shows; the focus handoff keys on this,
     * not on the raw state.
     */
    readonly effectiveLevel: Signal<LiveSidebarState>;

    constructor(private readonly options: LivePanelsControllerOptions) {
        const surface = options.surface;
        this.isSidebarCollapsed = this.sidebarState.isCollapsedFor(surface);
        const categoriesHidden =
            this.sidebarState.areCategoriesHiddenFor(surface);
        this.canOpenCategoriesPopover = computed(
            () => this.categoriesPopover !== null && categoriesHidden()
        );
        this.isCategoriesRailFolded = computed(
            () => this.canOpenCategoriesPopover() && !this.isSidebarCollapsed()
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

        let focusedControl: HTMLElement | null = null;
        afterRenderEffect((onCleanup) => {
            if (!this.isCategoriesRailFolded()) {
                focusedControl = null;
                return;
            }

            const showButton = options.showCategoriesButton()?.nativeElement;
            const dropdown = options.categoryDropdownButton?.()?.nativeElement;
            if (focusedControl && !focusedControl.isConnected) {
                focusedControl = null;
                focusIfFocusLost(showButton);
            }

            const listeners = new AbortController();
            onCleanup(() => listeners.abort());
            const listenerOptions = { signal: listeners.signal };
            for (const control of [showButton, dropdown]) {
                if (!control) continue;
                const trackFocus = () => {
                    focusedControl = control;
                };
                if (control.ownerDocument.activeElement === control) {
                    trackFocus();
                }
                control.addEventListener('focus', trackFocus, listenerOptions);
                control.addEventListener(
                    'blur',
                    () => {
                        // A browser can fire blur before the node is detached.
                        queueMicrotask(() => {
                            if (
                                focusedControl === control &&
                                control.isConnected &&
                                control.ownerDocument.activeElement !== control
                            ) {
                                focusedControl = null;
                            }
                        });
                    },
                    listenerOptions
                );
            }
        });
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
