import { KeyValue, TitleCasePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OutputEmitterRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import {
    PortalChannelSortMode,
    getPortalChannelSortModeLabel,
    persistPortalChannelSortMode,
    restorePortalChannelSortMode,
    sortPortalChannelItems,
} from '@iptvnator/portal/shared/util';
import { EnrichedChannel } from '../all-channels-view/all-channels-view.component';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';
import { ResizableDirective } from '../../resizable/resizable.directive';

const GROUP_CHANNEL_SORT_STORAGE_KEY = 'm3u-groups-channel-sort-mode';

interface FilteredGroupView {
    readonly channels: Channel[];
    readonly count: number;
    readonly key: string;
    readonly titleMatches: boolean;
}

@Component({
    selector: 'app-groups-view',
    templateUrl: './groups-view.component.html',
    styleUrls: ['./groups-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        ResizableDirective,
        ScrollingModule,
        TitleCasePipe,
        TranslatePipe,
    ],
})
export class GroupsViewComponent {
    private readonly dialog = inject(MatDialog);
    private readonly hostEl = inject(ElementRef<HTMLElement>);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');

    /** Grouped channels object */
    readonly groupedChannels = input.required<{ [key: string]: Channel[] }>();
    readonly searchTerm = input('');

    /** EPG map for channel enrichment */
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();

    /** Progress tick to trigger progress recalculation */
    readonly progressTick = input.required<number>();

    /** Whether to show EPG data */
    readonly shouldShowEpg = input.required<boolean>();

    /** Currently active channel URL */
    readonly activeChannelUrl = input<string | undefined>();

    /** Set of favorite channel URLs */
    readonly favoriteIds = input<Set<string>>(new Set());

    /** Current outer sidebar width */
    readonly sidebarWidth = input<number | null>(null);

    /** Emits when a channel is selected */
    readonly channelSelected = output<Channel>();

    /** Emits when favorite is toggled */
    readonly favoriteToggled = output<{
        channel: Channel;
        event: MouseEvent;
    }>();

    /** Emits while the groups rail requests a larger total sidebar width */
    readonly sidebarWidthRequested = output<number>();

    /** Emits when the groups rail resize ends */
    readonly sidebarWidthRequestEnded = output<number>();

    readonly selectedGroupKey = signal<string | null>(null);
    readonly groupChannelSortMode = signal<PortalChannelSortMode>(
        restorePortalChannelSortMode(GROUP_CHANNEL_SORT_STORAGE_KEY)
    );
    readonly groupChannelSortLabel = computed(() =>
        getPortalChannelSortModeLabel(this.groupChannelSortMode())
    );
    readonly itemSize = computed(() => (this.shouldShowEpg() ? 68 : 48));
    readonly contextMenuChannel = signal<Channel | null>(null);
    readonly contextMenuPosition = signal({
        x: '0px',
        y: '0px',
    });

    private previousActiveChannelUrl: string | undefined;
    private preservedContentWidth = 0;

    constructor() {
        effect(() => {
            const filteredGroups = this.filteredGroups();
            const visibleGroupKeys = new Set(
                filteredGroups.map((group) => group.key)
            );
            const currentSelection = this.selectedGroupKey();
            const activeGroupKey = this.activeChannelGroupKey();
            const activeChannelUrl = this.activeChannelUrl();
            const activeChannelChanged =
                activeChannelUrl !== this.previousActiveChannelUrl;

            this.previousActiveChannelUrl = activeChannelUrl;

            let nextSelection: string | null = null;

            if (
                activeChannelChanged &&
                activeGroupKey &&
                visibleGroupKeys.has(activeGroupKey)
            ) {
                nextSelection = activeGroupKey;
            } else if (
                currentSelection &&
                visibleGroupKeys.has(currentSelection)
            ) {
                nextSelection = currentSelection;
            } else if (activeGroupKey && visibleGroupKeys.has(activeGroupKey)) {
                nextSelection = activeGroupKey;
            } else {
                nextSelection = filteredGroups[0]?.key ?? null;
            }

            if (nextSelection !== currentSelection) {
                this.selectedGroupKey.set(nextSelection);
            }
        });

        effect(() => {
            const selectedGroupKey = this.selectedGroupKey();
            if (selectedGroupKey == null) {
                return;
            }

            queueMicrotask(() => {
                const container = this.hostEl.nativeElement.querySelector(
                    '.groups-nav-list'
                ) as HTMLElement | null;
                const candidates = Array.from(
                    this.hostEl.nativeElement.querySelectorAll(
                        '[data-group-key]'
                    )
                ) as HTMLElement[];
                const selected =
                    candidates.find(
                        (candidate) =>
                            candidate.dataset['groupKey'] === selectedGroupKey
                    ) ?? null;

                if (!container || !selected) {
                    return;
                }

                const containerRect = container.getBoundingClientRect();
                const selectedRect = selected.getBoundingClientRect();
                const targetTop =
                    container.scrollTop +
                    (selectedRect.top - containerRect.top) -
                    container.clientHeight / 2 +
                    selectedRect.height / 2;
                const maxScrollTop = Math.max(
                    0,
                    container.scrollHeight - container.clientHeight
                );

                container.scrollTo({
                    behavior: 'smooth',
                    top: Math.min(maxScrollTop, Math.max(0, targetTop)),
                });
            });
        });
    }

    readonly sortedGroups = computed(() => {
        const grouped = this.groupedChannels();
        const groups = Object.entries(grouped).map(([key, channels]) => ({
            key,
            value: channels,
        }));

        return groups.sort(this.groupsComparator);
    });

    readonly filteredGroups = computed<FilteredGroupView[]>(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const groups = this.sortedGroups();

        if (!term) {
            return groups
                .filter((group) => group.value.length > 0)
                .map((group) => ({
                    channels: group.value,
                    count: group.value.length,
                    key: group.key,
                    titleMatches: false,
                }));
        }

        return groups.reduce<FilteredGroupView[]>((acc, group) => {
            const titleMatches = group.key.toLowerCase().includes(term);
            const channels = titleMatches
                ? group.value
                : group.value.filter((channel) =>
                      `${channel.name ?? ''}`.toLowerCase().includes(term)
                  );

            if (channels.length === 0) {
                return acc;
            }

            acc.push({
                channels,
                count: channels.length,
                key: group.key,
                titleMatches,
            });
            return acc;
        }, []);
    });

    readonly selectedGroup = computed(() => {
        const selectedGroupKey = this.selectedGroupKey();
        return (
            this.filteredGroups().find(
                (group) => group.key === selectedGroupKey
            ) ?? null
        );
    });

    readonly selectedGroupChannels = computed<EnrichedChannel[]>(() => {
        const group = this.selectedGroup();
        const sortMode = this.groupChannelSortMode();
        const epgMap = this.channelEpgMap();
        this.progressTick();

        if (!group) {
            return [];
        }

        return sortPortalChannelItems(
            group.channels,
            sortMode,
            (channel) => channel?.name
        ).map((channel) => {
            const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
            const epgProgram = channelId ? epgMap.get(channelId) : null;
            return {
                ...channel,
                epgProgram,
                progressPercentage: this.calculateProgress(epgProgram),
            } as EnrichedChannel;
        });
    });

    readonly activeChannelGroupKey = computed(() => {
        const activeChannelUrl = this.activeChannelUrl();
        if (!activeChannelUrl) {
            return null;
        }

        const grouped = this.groupedChannels();
        for (const [groupKey, channels] of Object.entries(grouped)) {
            if (channels.some((channel) => channel.url === activeChannelUrl)) {
                return groupKey;
            }
        }

        return null;
    });

    selectGroup(groupKey: string): void {
        this.selectedGroupKey.set(groupKey);
    }

    setGroupChannelSortMode(mode: PortalChannelSortMode): void {
        this.groupChannelSortMode.set(mode);
        persistPortalChannelSortMode(GROUP_CHANNEL_SORT_STORAGE_KEY, mode);
    }

    onGroupsNavResizeStart(): void {
        this.preservedContentWidth = this.measureContentPanelWidth();
    }

    onGroupsNavWidthChange(width: number): void {
        this.emitSidebarWidthRequest(width, this.sidebarWidthRequested);
    }

    onGroupsNavResizeEnd(width: number): void {
        this.emitSidebarWidthRequest(width, this.sidebarWidthRequestEnded);
        this.preservedContentWidth = 0;
    }

    trackByChannel(_: number, channel: Channel): string {
        return channel?.id;
    }

    trackByGroupKey(_: number, group: FilteredGroupView): string {
        return group.key;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    onFavoriteToggle(channel: Channel, event: MouseEvent): void {
        this.favoriteToggled.emit({ channel, event });
    }

    onChannelContextMenu(channel: Channel, event: MouseEvent): void {
        this.contextMenuChannel.set(channel);
        this.contextMenuPosition.set({
            x: `${event.clientX}px`,
            y: `${event.clientY}px`,
        });

        const trigger = this.contextMenuTrigger();
        if (trigger.menuOpen) {
            trigger.closeMenu();
        }

        queueMicrotask(() => {
            this.contextMenuTrigger().openMenu();
        });
    }

    openChannelDetails(): void {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        this.dialog.open(ChannelDetailsDialogComponent, {
            data: channel,
            maxWidth: '720px',
            width: 'calc(100vw - 32px)',
        });
    }

    /**
     * Comparator for sorting groups - numeric groups first, then alphabetical
     */
    readonly groupsComparator = (
        a: KeyValue<string, Channel[]> | { key: string; value: Channel[] },
        b: KeyValue<string, Channel[]> | { key: string; value: Channel[] }
    ): number => {
        const numA = parseInt(a.key.replace(/\D/g, ''), 10);
        const numB = parseInt(b.key.replace(/\D/g, ''), 10);

        if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
            return numA - numB;
        }

        if (!Number.isNaN(numA) && Number.isNaN(numB)) {
            return -1;
        }

        if (Number.isNaN(numA) && !Number.isNaN(numB)) {
            return 1;
        }

        return a.key.localeCompare(b.key);
    };

    private calculateProgress(
        epgProgram: EpgProgram | null | undefined
    ): number {
        if (!epgProgram) {
            return 0;
        }

        const now = Date.now();
        const start = new Date(epgProgram.start).getTime();
        const stop = new Date(epgProgram.stop).getTime();

        if (!Number.isFinite(start) || !Number.isFinite(stop)) {
            return 0;
        }

        const total = stop - start;
        if (total <= 0) {
            return 0;
        }

        const elapsed = Math.min(total, Math.max(0, now - start));
        return Math.round((elapsed / total) * 100);
    }

    private emitSidebarWidthRequest(
        navWidth: number,
        emitter: OutputEmitterRef<number>
    ): void {
        const preservedContentWidth =
            this.preservedContentWidth ||
            this.measureContentPanelWidth(navWidth);
        const requestedWidth = Math.round(navWidth + preservedContentWidth);

        if (requestedWidth > 0) {
            emitter.emit(requestedWidth);
        }
    }

    private measureContentPanelWidth(currentNavWidth?: number): number {
        const contentPanel = this.hostEl.nativeElement.querySelector(
            '.groups-content-panel'
        );
        const measuredContentWidth = this.readWidth(contentPanel);
        if (measuredContentWidth > 0) {
            return measuredContentWidth;
        }

        const hostWidth = this.readWidth(this.hostEl.nativeElement);
        const totalWidth =
            hostWidth > 0 ? hostWidth : Math.max(0, this.sidebarWidth() ?? 0);
        const navPanel =
            this.hostEl.nativeElement.querySelector('.groups-nav-panel');
        const navWidth = currentNavWidth ?? this.readWidth(navPanel);

        if (totalWidth > 0 && navWidth > 0) {
            return Math.max(0, totalWidth - navWidth);
        }

        return 0;
    }

    private readWidth(element: Element | null): number {
        if (!element) {
            return 0;
        }

        const rectWidth = element.getBoundingClientRect().width;
        if (rectWidth > 0) {
            return rectWidth;
        }

        if (!(element instanceof HTMLElement)) {
            return 0;
        }

        if (element.offsetWidth > 0) {
            return element.offsetWidth;
        }

        const inlineWidth = Number.parseFloat(element.style.width);
        if (Number.isFinite(inlineWidth) && inlineWidth > 0) {
            return inlineWidth;
        }

        const computedWidth = Number.parseFloat(
            window.getComputedStyle(element).width
        );
        if (Number.isFinite(computedWidth) && computedWidth > 0) {
            return computedWidth;
        }

        return 0;
    }
}
