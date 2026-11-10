import {
    afterNextRender,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    Injectable,
    Injector,
    Signal,
    signal,
    untracked,
} from '@angular/core';
import {
    EpgPreferencesService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    isTypingInInput,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import {
    persistEpgGuideDockCollapsed,
    restoreEpgGuideDockCollapsed,
} from '@iptvnator/ui/epg';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

const ACTION = 'xtream-epg-guide';

@Injectable()
export class XtreamLiveGuideService {
    private readonly source = inject(XtreamEpgGuideSourceService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly preferences = inject(EpgPreferencesService);
    private readonly header = inject(WorkspaceHeaderContextService);
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);
    private readonly playing = signal<Signal<boolean> | null>(null);
    private returnFocus: HTMLElement | null = null;

    readonly isOpen = signal(false);
    readonly collapsed = signal(restoreEpgGuideDockCollapsed());
    private readonly enabled = computed(
        () => this.runtime.supportsProviderEpg && this.preferences.enabled()
    );
    readonly available = computed(
        () => this.enabled() && !!this.playing()?.() && !!this.source.playlist()
    );

    constructor() {
        effect((onCleanup) => {
            const playlistId = this.source.playlist()?.id;
            if (!playlistId || !this.enabled()) return;
            const action = {
                id: ACTION,
                owner: { provider: 'xtreams', playlistId, section: 'live' },
                icon: 'grid_view',
                tooltipKey: 'TOP_MENU.OPEN_EPG_GUIDE',
                ariaLabelKey: 'TOP_MENU.OPEN_EPG_GUIDE',
                active: this.isOpen,
                disabled: () => !this.available(),
                hidesContextPanel: this.isOpen,
                palette: {
                    labelKey: 'TOP_MENU.OPEN_EPG_GUIDE',
                    descriptionKey:
                        'WORKSPACE.SHELL.COMMANDS.OPEN_EPG_GUIDE_DESCRIPTION',
                    keywords: ['epg', 'guide', 'schedule'],
                    priority: 10,
                },
                run: () => {
                    if (this.header.action() === action) this.toggle();
                },
            };
            this.header.setAction(action);
            onCleanup(() =>
                untracked(() => {
                    if (this.header.action() === action)
                        this.header.clearAction(ACTION);
                    this.close();
                })
            );
        });
        effect(() => {
            if (!this.available()) untracked(() => this.close());
        });
        this.destroyRef.onDestroy(() => this.source.close());
    }

    bind(playing: Signal<boolean>): void {
        this.playing.set(playing);
    }

    open(): void {
        if (
            this.destroyRef.destroyed ||
            this.isOpen() ||
            !this.available() ||
            this.blocked()
        )
            return;
        this.returnFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        this.source.open();
        this.isOpen.set(true);
        afterNextRender(
            () =>
                this.element.nativeElement
                    .querySelector<HTMLElement>('.epg-guide-host')
                    ?.focus(),
            { injector: this.injector }
        );
    }

    close(): void {
        if (!this.isOpen()) return;
        const focused = document.activeElement;
        const restoreFocus =
            focused instanceof Element &&
            !!focused.closest('.epg-guide-host, app-epg-guide-now-playing');
        this.isOpen.set(false);
        this.source.close();
        if (restoreFocus && !this.destroyRef.destroyed)
            afterNextRender(
                () => {
                    const target = this.returnFocus?.isConnected
                        ? this.returnFocus
                        : document.querySelector<HTMLElement>(
                              `[data-test-id="${ACTION}"]`
                          );
                    target?.focus();
                },
                { injector: this.injector }
            );
    }

    toggle(): void {
        if (this.isOpen()) this.close();
        else this.open();
    }

    setCollapsed(collapsed: boolean): void {
        this.collapsed.set(collapsed);
        persistEpgGuideDockCollapsed(collapsed);
    }

    handleKey(event: KeyboardEvent): void {
        if (
            event.defaultPrevented ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            isTypingInInput(event) ||
            event.key.toLowerCase() !== 'g' ||
            (!this.isOpen() && !this.available()) ||
            this.blocked() ||
            event
                .composedPath()
                .some(
                    (target) =>
                        target instanceof Element &&
                        target.matches('.cdk-overlay-pane')
                )
        )
            return;
        this.toggle();
        event.preventDefault();
    }

    closeOnFullscreen(): void {
        if (document.fullscreenElement) this.close();
    }

    private blocked(): boolean {
        return (
            !!document.fullscreenElement ||
            !!this.element.nativeElement.closest('[inert]') ||
            !!document.querySelector(
                '.cdk-overlay-pane [role="dialog"], .cdk-overlay-pane [role="menu"]'
            )
        );
    }
}
