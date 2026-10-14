import { A11yModule } from '@angular/cdk/a11y';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    linkedSignal,
    output,
    signal,
    viewChild,
    viewChildren,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    SourceStatusService,
    sourceStatusBucket,
} from '@iptvnator/portal/shared/data-access';
import {
    countSourcesByType,
    orderFailingFirst,
    PlaylistContextFacade,
    PlaylistRecentHistoryService,
    replacementAfterRemoval,
    SourceBucketOf,
    sourceSortName,
    SourcesTypeFilter,
} from '@iptvnator/playlist/shared/util';
import {
    SortBy,
    SortService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta, PlaylistSourceKind } from '@iptvnator/shared/interfaces';
import { PlaylistRefreshActionService } from '../playlist-refresh-action.service';
import { PlaylistInfoComponent } from '../recent-playlists/playlist-info/playlist-info.component';
import { SourceRemovalService } from '../source-removal/source-removal.service';
import { SourceRowComponent } from '../source-row/source-row.component';
import { XtreamRefreshFlowService } from '../xtream-refresh-flow.service';
import {
    buildSwitcherGroups,
    moveHighlight,
    readSwitcherType,
    SwitcherOption,
    writeSwitcherType,
} from './playlist-switcher-list';

const KINDS: readonly PlaylistSourceKind[] = ['m3u', 'xtream', 'stalker'];

/**
 * The switcher popover: search, a type segment, "Recent" and "All" groups
 * of compact source rows, and a footer. Focus stays in the search field;
 * ↑/↓ move the highlight (`aria-activedescendant`), Enter opens it,
 * Shift+F10 opens its menu and Escape closes the popover.
 */
@Component({
    selector: 'app-playlist-switcher-panel',
    imports: [
        A11yModule,
        MatButton,
        MatButtonToggleModule,
        MatIcon,
        MatIconButton,
        MatTooltip,
        NgTemplateOutlet,
        SourceRowComponent,
        TranslatePipe,
    ],
    templateUrl: './playlist-switcher-panel.component.html',
    styleUrl: './playlist-switcher-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaylistSwitcherPanelComponent {
    private readonly activity = inject(SourceActivityService);
    private readonly context = inject(PlaylistContextFacade);
    private readonly document = inject(DOCUMENT);
    private readonly dialog = inject(MatDialog);
    private readonly recentHistory = inject(PlaylistRecentHistoryService);
    private readonly refreshAction = inject(PlaylistRefreshActionService);
    private readonly removal = inject(SourceRemovalService);
    private readonly router = inject(Router);
    private readonly sortService = inject(SortService);
    private readonly statusService = inject(SourceStatusService);
    private readonly xtreamRefreshFlow = inject(XtreamRefreshFlowService);
    private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
    private readonly searchInput =
        viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
    private readonly rows = viewChildren(SourceRowComponent);
    private readonly rowElements = viewChildren(SourceRowComponent, {
        read: ElementRef,
    });

    readonly closeRequested = output<void>();
    private closing = false;
    readonly playlistSelected = output<string>();
    readonly addPlaylistRequested = output<void>();
    readonly accountInfoRequested = output<PlaylistMeta>();

    readonly listId = 'playlist-switcher-listbox';
    readonly kinds = KINDS;
    readonly kindLabels = { m3u: 'M3U', xtream: 'Xtream', stalker: 'Stalker' };
    readonly currentId = this.context.resolvedPlaylistId;
    readonly query = signal('');
    readonly type = signal<SourcesTypeFilter>(readSwitcherType());

    private readonly sortOptions = toSignal(this.sortService.getSortOptions(), {
        requireSync: true,
    });
    private readonly bucketOf: SourceBucketOf = (playlist) => {
        const status = this.statusService.statusOf(playlist);
        return status ? sourceStatusBucket(status.reachability) : null;
    };

    /**
     * Every source except one whose delete is pending or running: a running
     * delete shows its progress and Cancel on the Sources page, and its
     * source cannot be opened or removed again from here.
     */
    readonly playlists = computed(() => {
        const pending = this.removal.pendingIds();
        return this.context
            .playlists()
            .filter(
                (playlist) =>
                    !pending.has(playlist._id) &&
                    !this.removal.progress.isDeleting(playlist._id)
            );
    });
    readonly typeCounts = computed(() =>
        countSourcesByType(this.playlists(), 'all', this.bucketOf)
    );
    readonly showTypeFilter = computed(
        () => KINDS.filter((kind) => this.typeCounts()[kind] > 0).length > 1
    );
    /**
     * The type the list filters by: the remembered one while it has sources
     * and its segment shows, else All. Removing the last source of the
     * remembered type would otherwise leave an empty list with no segment
     * selected. The remembered choice itself is kept for when it returns.
     */
    readonly activeType = computed<SourcesTypeFilter>(() => {
        const type = this.type();
        return this.showTypeFilter() &&
            (type === 'all' || this.typeCounts()[type] > 0)
            ? type
            : 'all';
    });
    /** The Sources page order, so both lists agree. */
    private readonly ordered = computed(() => {
        const options = this.sortOptions();
        const sorted = this.sortService.sortPlaylists(
            this.playlists(),
            options,
            sourceSortName
        );
        return options.failingFirst && options.by !== SortBy.CUSTOM
            ? orderFailingFirst(sorted, this.bucketOf)
            : sorted;
    });
    readonly groups = computed(() =>
        buildSwitcherGroups(
            this.ordered(),
            this.recentHistory.ids(),
            this.activeType(),
            this.query()
        )
    );
    readonly options = computed<SwitcherOption[]>(() => [
        ...this.groups().recent,
        ...this.groups().all,
    ]);
    /**
     * A search highlights its first match, so Enter opens it. When the list
     * changes under the same search (a source added or removed), the
     * highlight stays on its option, or on the same place, clamped.
     */
    readonly highlight = linkedSignal<
        {
            query: string;
            type: SourcesTypeFilter;
            ids: readonly string[];
        },
        number
    >({
        source: () => ({
            query: this.query(),
            type: this.activeType(),
            ids: this.options().map((option) => option.id),
        }),
        computation: (source, previous) => {
            const sameSearch =
                previous &&
                previous.source.query === source.query &&
                previous.source.type === source.type;
            if (!sameSearch) {
                return source.query.trim() ? 0 : -1;
            }
            const id = previous.source.ids[previous.value];
            const kept = id === undefined ? -1 : source.ids.indexOf(id);
            return kept !== -1
                ? kept
                : Math.min(previous.value, source.ids.length - 1);
        },
    });
    readonly activeOptionId = computed(
        () => this.options()[this.highlight()]?.id ?? null
    );

    constructor() {
        // Typing goes straight to the search. Not the focus trap's
        // auto-capture: on close it would move focus back to wherever it was
        // before ⌘P, and closing returns it to the trigger instead.
        afterNextRender(() => this.searchInput().nativeElement.focus());
    }

    setQuery(value: string): void {
        this.query.set(value);
        this.scrollToTop();
    }

    setType(type: SourcesTypeFilter): void {
        this.type.set(type);
        writeSwitcherType(type);
        this.scrollToTop();
    }

    /**
     * A new search or type highlights the first match, at the top of the
     * list: a list scrolled down for the previous one would hide it.
     */
    private scrollToTop(): void {
        this.list().nativeElement.scrollTop = 0;
    }

    onSearchKeydown(event: KeyboardEvent): void {
        const count = this.options().length;
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault();
                this.highlight.set(
                    moveHighlight(
                        this.highlight(),
                        event.key === 'ArrowDown' ? 1 : -1,
                        count
                    )
                );
                this.scrollHighlightIntoView();
                break;
            case 'Enter': {
                const option = this.options()[this.highlight()];
                if (option) {
                    event.preventDefault();
                    this.select(option.playlist);
                }
                break;
            }
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                this.close();
                break;
            case 'ContextMenu':
            case 'F10':
                if (event.key === 'ContextMenu' || event.shiftKey) {
                    event.preventDefault();
                    this.openHighlightedMenu();
                }
                break;
        }
    }

    select(playlist: PlaylistMeta): void {
        // Pointer and Enter alike: opening it would race the refresh.
        if (this.isRefreshing(playlist)) {
            return;
        }
        this.context.selectPlaylist(playlist);
        this.playlistSelected.emit(playlist._id);
        this.close();
    }

    canRefresh(playlist: PlaylistMeta): boolean {
        return this.refreshAction.canRefresh(playlist);
    }

    /**
     * A refresh is clearing and refilling the source: it cannot be opened
     * until the refresh has parked the user data its import restores.
     */
    isRefreshing(playlist: PlaylistMeta): boolean {
        return (
            this.refreshAction.isSourceBusy(playlist._id) ||
            this.xtreamRefreshFlow.isRunning(playlist._id)
        );
    }

    /** A source cannot be removed while a refresh clears and refills it. */
    isBusy(playlist: PlaylistMeta): boolean {
        return this.activity.isBusy(playlist._id);
    }

    refresh(playlist: PlaylistMeta): void {
        this.close();
        this.refreshAction.refresh(playlist);
    }

    openInfo(playlist: PlaylistMeta): void {
        this.close();
        this.dialog.open(PlaylistInfoComponent, { data: playlist });
    }

    openAccountInfo(playlist: PlaylistMeta): void {
        this.close();
        this.accountInfoRequested.emit(playlist);
    }

    /**
     * Deletes with Undo; the active source hands over to its neighbour. The
     * popover closes first: its focus trap would keep the keyboard away
     * from Undo, which then takes the focus and returns it to the trigger.
     */
    remove(playlist: PlaylistMeta): void {
        const next = replacementAfterRemoval(
            this.groups().all.map((option) => option.playlist),
            playlist._id,
            (row) => !this.removal.canTakeOver(row._id)
        );
        this.close();
        // Closing put the focus back on the trigger.
        const returnFocusTo = this.document.activeElement;
        this.removal.remove(playlist, next, {
            returnFocusTo:
                returnFocusTo instanceof HTMLElement &&
                returnFocusTo !== this.document.body
                    ? returnFocusTo
                    : null,
        });
    }

    /** A row menu gives the focus back to the search, unless closing. */
    onMenuClosed(): void {
        if (!this.closing) {
            this.searchInput().nativeElement.focus();
        }
    }

    /**
     * Every action that leaves the popover closes it through here, so a row
     * menu closing after its action does not pull the focus back into it.
     */
    private close(): void {
        this.closing = true;
        this.closeRequested.emit();
    }

    addPlaylist(): void {
        this.close();
        this.addPlaylistRequested.emit();
    }

    openAllSources(): void {
        this.close();
        void this.router.navigate(['/workspace', 'sources']);
    }

    /** Shift+F10 / the menu key: the highlighted row's ⋯ menu. */
    private openHighlightedMenu(): void {
        const id = this.activeOptionId();
        const index = this.rowElements().findIndex(
            (element) => (element.nativeElement as HTMLElement).id === id
        );
        this.rows()[index]?.openMenu();
    }

    /** Keeps the highlighted option in the list's view, not the page's. */
    private scrollHighlightIntoView(): void {
        const id = this.activeOptionId();
        const list = this.list().nativeElement;
        // By exact ID, not a selector: a restored playlist ID may hold "."
        // or ":", which a selector would misread.
        const option = id
            ? this.rowElements()
                  .map((row) => row.nativeElement as HTMLElement)
                  .find((element) => element.id === id)
            : undefined;
        if (!option) {
            return;
        }
        const top = option.offsetTop;
        const bottom = top + option.offsetHeight;
        if (top < list.scrollTop) {
            list.scrollTop = top - 8;
        } else if (bottom > list.scrollTop + list.clientHeight) {
            list.scrollTop = bottom - list.clientHeight + 8;
        }
    }
}
