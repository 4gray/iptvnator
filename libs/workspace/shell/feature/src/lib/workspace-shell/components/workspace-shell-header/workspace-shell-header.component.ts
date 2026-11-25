import {
    afterNextRender,
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    Injector,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import {
    WorkspaceBackTarget,
    WorkspaceHeaderAction,
} from '@iptvnator/portal/shared/util';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { ImeInputDirective } from '@iptvnator/ui/components';
import { WorkspaceHeaderSidebarToggle } from '../../services/helpers/workspace-shell-constants';
import { LayoutSlideDirective } from '../../layout-slide.directive';
import {
    clampOverflowCount,
    HEADER_OVERFLOW_ORDER,
    HeaderOverflowItemId,
    measureHeaderActionSlot,
    measureHeaderGroupSlack,
    measureHeaderSpare,
    resolveHeaderOverflowCount,
} from './workspace-shell-header-overflow';

/** Mirrors the stylesheet's phone breakpoint, where the rail toggle hides. */
const PHONE_VIEWPORT_QUERY = '(max-width: 640px)';

@Component({
    selector: 'app-workspace-shell-header',
    imports: [
        ImeInputDirective,
        LayoutSlideDirective,
        MatIcon,
        MatIconButton,
        MatMenu,
        MatMenuItem,
        MatMenuTrigger,
        MatTooltip,
        PlaylistSwitcherComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-shell-header.component.html',
    styleUrl: './workspace-shell-header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellHeaderComponent {
    private readonly imeInput = viewChild(ImeInputDirective);
    private readonly overflowMenuTrigger = viewChild(MatMenuTrigger);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly injector = inject(Injector);
    private readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');
    // read: ElementRef because mat-icon-button is a component, so a bare
    // template-ref query would resolve to the MatIconButton instance.
    private readonly contextDrawerToggle = viewChild('contextDrawerToggle', {
        read: ElementRef<HTMLButtonElement>,
    });

    readonly isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    readonly commandShortcutLabel = this.isMac ? '⌘K' : 'Ctrl+K';

    /** The page's Back or the history fallback; null when there is neither. */
    readonly backTarget = input<WorkspaceBackTarget | null>(null);
    readonly playlistTitle = input('');
    readonly playlistSubtitle = input('');
    readonly searchQuery = input('');
    readonly canUseSearch = input(false);
    readonly searchPlaceholder = input('');
    readonly searchScopeLabel = input('');
    readonly searchStatusLabel = input('');
    readonly canClearCategoryScope = input(false);
    readonly headerShortcut = input<WorkspaceHeaderAction | null>(null);
    readonly headerSidebarToggle = input<WorkspaceHeaderSidebarToggle | null>(
        null
    );
    readonly isElectron = input(false);
    readonly hasNoPlaylists = input(false);
    readonly isDownloadsView = input(false);
    readonly activeDownloadsCount = input(0);
    readonly hasActiveDownloads = computed(
        () => this.activeDownloadsCount() > 0
    );
    /**
     * When true the playlist switcher + the "+ Add source" / refresh /
     * shortcut buttons are hidden — those controls scope to a
     * playlist, but Settings is a global page, so leaving them visible
     * implies (falsely) that switching the playlist changes which
     * settings you're editing. Driven from the shell facade's existing
     * isSettingsRoute computed.
     */
    readonly isSettingsRoute = input(false);
    /**
     * Parental lock indicator: `off` hides the button, `locked` offers the
     * PIN prompt, `unlocked` offers "Lock now".
     */
    readonly parentalLockState = input<'off' | 'locked' | 'unlocked'>('off');
    /**
     * Phone-width (≤640px) drawer toggle for the context panel. The button
     * itself is hidden by CSS above the phone breakpoint, so these inputs
     * only matter on small viewports: `showContextDrawerToggle` reflects
     * whether the current route has panel content to show, and
     * `isContextDrawerOpen` feeds aria-expanded.
     */
    readonly showContextDrawerToggle = input(false);
    readonly isContextDrawerOpen = input(false);
    /**
     * Variant-aware labels: the drawer holds categories on portal routes,
     * type filters on sources/collection routes, and section navigation on
     * the settings route — a fixed "Categories & filters" label would
     * misdescribe two of the three.
     */
    readonly contextDrawerToggleAriaKey = input(
        'WORKSPACE.SHELL.CONTEXT_DRAWER_CATEGORIES_TOGGLE'
    );
    readonly contextDrawerTooltipKey = input(
        'WORKSPACE.SHELL.CONTEXT_DRAWER_CATEGORIES_TOOLTIP'
    );

    private readonly backPhoneSlot = computed(() => {
        const back = this.backTarget();
        return back ? (back.phoneDrawerToggle ?? 'replace') : null;
    });
    /** The drawer toggle renders unless Back takes its phone slot. */
    readonly showDrawerToggle = computed(
        () =>
            this.showContextDrawerToggle() && this.backPhoneSlot() !== 'replace'
    );
    /** At phone width, Back hides behind a shown drawer toggle. */
    readonly backYieldsToDrawerToggle = computed(
        () => this.showDrawerToggle() && this.backPhoneSlot() === 'yield'
    );
    /**
     * The leading navigation: when Back or the drawer toggle appears or
     * leaves, the controls after it slide instead of jumping.
     */
    readonly leadingNavigationKey = computed(
        () =>
            `${this.backTarget() !== null}|${this.showDrawerToggle()}|${this.backYieldsToDrawerToggle()}`
    );
    /** Everything else that moves the controls; recorded, not slid. */
    readonly controlsLayoutKey = computed(
        () =>
            `${this.isSettingsRoute()}|${this.hasNoPlaylists()}|${this.isElectron()}|${this.parentalLockState()}|${this.headerSidebarToggle() !== null}|${this.headerShortcut() !== null}|${this.overflowedActions().size}|${this.showSearchField()}`
    );

    /**
     * Never a disabled field: where search cannot run (the PWA dashboard,
     * which has no global search) the field leaves its room to the actions.
     * Settings search works without any playlist, so a fresh user can find
     * settings before importing a first source.
     */
    readonly showSearchField = computed(
        () =>
            this.canUseSearch() &&
            (!this.hasNoPlaylists() || this.isSettingsRoute())
    );

    /** Where the field would show but search cannot run. */
    readonly showStandaloneCommandTrigger = computed(
        () =>
            !this.canUseSearch() &&
            (!this.hasNoPlaylists() || this.isSettingsRoute())
    );

    private readonly phoneViewport = signal(matchesPhoneViewport());
    /** How many actions the last measurement moved into the menu. */
    protected readonly overflowCount = signal(0);
    /**
     * Gap and divider that leave with the contextual group, kept from the
     * last time the group rendered (8px gap, 8px padding, 1px border).
     */
    private groupSlack = 17;
    /** Actions present now that may move into the menu, in hide order. */
    readonly overflowCandidates = computed<HeaderOverflowItemId[]>(() =>
        HEADER_OVERFLOW_ORDER.filter((id) => this.isActionPresent(id))
    );
    readonly overflowedActions = computed(() => {
        const candidates = this.overflowCandidates();
        const count = clampOverflowCount(
            this.overflowCount(),
            candidates.length
        );
        return new Set(candidates.slice(0, count));
    });
    /** Menu rows in header order: the contextual actions, then Add. */
    readonly overflowMenuItems = computed(() =>
        [...HEADER_OVERFLOW_ORDER].filter((id) =>
            this.overflowedActions().has(id)
        )
    );
    /**
     * The divider separates the page's own actions from the global ones,
     * so it shows only while a contextual action is still inline.
     */
    readonly hasInlineContextualActions = computed(() =>
        this.overflowCandidates().some(
            (id) => id !== 'add-source' && !this.overflowedActions().has(id)
        )
    );

    readonly backRequested = output<void>();
    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly headerSidebarToggleRequested = output<void>();
    readonly parentalLockToggleRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly contextDrawerToggleRequested = output<void>();
    readonly accountInfoForPlaylistRequested = output<PlaylistMeta>();
    readonly clearCategoryScopeRequested = output<void>();

    constructor() {
        const destroyRef = inject(DestroyRef);
        if (typeof window !== 'undefined' && window.matchMedia) {
            const query = window.matchMedia(PHONE_VIEWPORT_QUERY);
            const onChange = () => this.phoneViewport.set(query.matches);
            query.addEventListener?.('change', onChange);
            destroyRef.onDestroy(() =>
                query.removeEventListener?.('change', onChange)
            );
        }

        // The header's own box and each region in it: a region that grows
        // (a longer source title, Back appearing) changes the room as much
        // as a window resize does.
        const observer =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => this.measureOverflow());
        destroyRef.onDestroy(() => observer?.disconnect());
        // Regions come and go (Settings drops the switcher and search):
        // unobserve the removed ones so their elements can be collected.
        let observed = new Set<Element>();
        afterRenderEffect({
            read: () => {
                this.controlsLayoutKey();
                this.leadingNavigationKey();
                this.overflowCandidates();
                const header = this.headerElement();
                if (observer && header) {
                    const current = new Set<Element>([
                        header,
                        ...Array.from(header.children),
                    ]);
                    observed.forEach((element) => {
                        if (!current.has(element)) {
                            observer.unobserve(element);
                        }
                    });
                    current.forEach((element) => {
                        if (!observed.has(element)) {
                            observer.observe(element);
                        }
                    });
                    observed = current;
                }
                this.measureOverflow();
            },
        });
    }

    isActionInline(id: HeaderOverflowItemId): boolean {
        return !this.overflowedActions().has(id);
    }

    onClearCategoryScope(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.clearCategoryScopeRequested.emit();
        this.searchInput()?.nativeElement.focus();
    }

    focusSearchInput(options: { select?: boolean } = {}): void {
        const inputElement = this.searchInput()?.nativeElement;
        if (!inputElement || inputElement.disabled) {
            return;
        }

        inputElement.focus();
        if (options.select) {
            inputElement.select();
        }
    }

    containsSearchInput(target: EventTarget | null): boolean {
        const inputElement = this.searchInput()?.nativeElement;
        return !!inputElement && target === inputElement;
    }

    onSearchInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.searchChanged.emit(target?.value ?? '');
    }

    onSearchEnter(event: Event): void {
        if (this.imeInput()?.isCompositionKey(event)) {
            return;
        }
        const target = event.target as HTMLInputElement | null;
        this.searchSubmitted.emit(target?.value ?? this.searchQuery());
    }

    /**
     * The tooltip advertises Escape for Back. The page only handles it with
     * focus inside the page, so the button keeps that promise itself.
     */
    onBackEscape(event: Event): void {
        const keyboard = event as KeyboardEvent;
        if (
            !this.backTarget()?.escapeShortcut() ||
            keyboard.defaultPrevented ||
            keyboard.repeat ||
            keyboard.altKey ||
            keyboard.ctrlKey ||
            keyboard.metaKey ||
            keyboard.shiftKey
        ) {
            return;
        }
        keyboard.preventDefault();
        this.backRequested.emit();
    }

    onAccountInfoForPlaylistRequested(playlist: PlaylistMeta): void {
        this.accountInfoForPlaylistRequested.emit(playlist);
    }

    onAddPlaylistRequested(): void {
        this.addPlaylistRequested.emit();
    }

    onCommandPaletteRequested(): void {
        this.commandPaletteRequested.emit();
    }

    onHeaderShortcutRequested(): void {
        this.headerShortcutRequested.emit();
    }

    onHeaderSidebarToggleRequested(): void {
        this.headerSidebarToggleRequested.emit();
    }

    onDownloadsRequested(): void {
        this.downloadsRequested.emit();
    }

    onContextDrawerToggleRequested(): void {
        this.contextDrawerToggleRequested.emit();
    }

    /**
     * Returns focus to the drawer toggle after the drawer closes. Reports
     * whether the toggle actually received focus — after a navigation to a
     * route without a context panel the toggle is gone (and above the phone
     * breakpoint it is display: none, where focus() silently does nothing),
     * and the caller then needs a fallback target.
     */
    focusContextDrawerToggle(): boolean {
        const toggle = this.contextDrawerToggle()?.nativeElement;
        if (!toggle) {
            return false;
        }

        toggle.focus();
        return document.activeElement === toggle;
    }

    private isActionPresent(id: HeaderOverflowItemId): boolean {
        switch (id) {
            case 'layout':
                return (
                    !this.isSettingsRoute() && this.headerShortcut() !== null
                );
            case 'sidebar':
                return (
                    !this.isSettingsRoute() &&
                    this.headerSidebarToggle() !== null &&
                    !this.phoneViewport()
                );
            case 'parental-lock':
                return this.parentalLockState() !== 'off';
            case 'add-source':
                return true;
        }
    }

    private headerElement(): HTMLElement | null {
        return (this.hostElement.nativeElement as HTMLElement).querySelector(
            '.workspace-header'
        );
    }

    private measureOverflow(): void {
        const header = this.headerElement();
        const actions = header?.querySelector<HTMLElement>(
            '.header-actions-cluster'
        );
        // Not laid out (a hidden window, a test DOM): keep the last plan.
        if (!header || !actions || header.clientWidth === 0) {
            return;
        }

        this.groupSlack = measureHeaderGroupSlack(actions) ?? this.groupSlack;
        const candidates = this.overflowCandidates();
        const next = resolveHeaderOverflowCount({
            candidates: candidates.length,
            contextual: candidates.filter((id) => id !== 'add-source').length,
            groupSlack: this.groupSlack,
            spare: measureHeaderSpare(
                header,
                header.querySelector<HTMLElement>('.search-field')
            ),
            slot: measureHeaderActionSlot(actions),
            current: this.overflowedActions().size,
        });
        if (next !== this.overflowCount()) {
            if (
                actions.contains(document.activeElement) ||
                this.overflowMenuTrigger()?.menuOpen
            ) {
                this.keepFocusInActions(actions);
            }
            this.overflowCount.set(next);
        }
    }

    /**
     * A focused action that moves into "More actions" is destroyed with its
     * button, and so is the trigger (and its open menu) when every action
     * returns inline. Focus then goes to the trigger, or to the last action
     * without one, so a keyboard user keeps their place.
     */
    private keepFocusInActions(actions: HTMLElement): void {
        afterNextRender(
            {
                write: () => {
                    const active = document.activeElement;
                    if (active && active !== document.body) {
                        return;
                    }
                    const buttons =
                        actions.querySelectorAll<HTMLElement>('button');
                    (
                        actions.querySelector<HTMLElement>(
                            '.header-overflow-trigger'
                        ) ?? buttons[buttons.length - 1]
                    )?.focus();
                },
            },
            { injector: this.injector }
        );
    }
}

function matchesPhoneViewport(): boolean {
    return (
        typeof window !== 'undefined' &&
        !!window.matchMedia?.(PHONE_VIEWPORT_QUERY).matches
    );
}
