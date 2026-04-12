import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Channel } from 'shared-interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { GroupManagementDialogComponent } from './group-management-dialog/group-management-dialog.component';
import { GroupsViewComponent } from './groups-view.component';

const GROUP_CHANNEL_SORT_STORAGE_KEY = 'm3u-groups-channel-sort-mode';

function createChannel(
    id: string,
    name: string,
    url: string,
    groupTitle: string
): Channel {
    return {
        epgParams: '',
        group: {
            title: groupTitle,
        },
        http: {
            origin: '',
            referrer: '',
            'user-agent': '',
        },
        id,
        name,
        radio: 'false',
        tvg: {
            id: `${id}-tvg`,
            logo: '',
            name,
            rec: '',
            url: '',
        },
        url,
    } as Channel;
}

describe('GroupsViewComponent', () => {
    let fixture: ComponentFixture<GroupsViewComponent>;
    let component: GroupsViewComponent;
    let dialog: { open: jest.Mock };

    const sportsCenter = createChannel(
        'sports-1',
        'Sports Center',
        'http://example.com/sports-center.m3u8',
        'Sports'
    );
    const matchNight = createChannel(
        'sports-2',
        'Match Night',
        'http://example.com/match-night.m3u8',
        'Sports'
    );
    const worldUpdate = createChannel(
        'news-1',
        'World Update',
        'http://example.com/world-update.m3u8',
        'News'
    );
    const dailyBulletin = createChannel(
        'news-2',
        'Daily Bulletin',
        'http://example.com/daily-bulletin.m3u8',
        'News'
    );
    const movieClassic = createChannel(
        'movies-1',
        'Movie Classic',
        'http://example.com/movie-classic.m3u8',
        'Movies'
    );
    const scienceNow = createChannel(
        'science-1',
        'Science Now',
        'http://example.com/science-now.m3u8',
        'Series'
    );

    const groupedChannels: Record<string, Channel[]> = {
        Movies: [movieClassic],
        News: [worldUpdate, dailyBulletin],
        Series: [scienceNow],
        Sports: [sportsCenter, matchNight],
    };

    beforeAll(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            value: jest.fn(),
            writable: true,
        });
    });

    beforeEach(async () => {
        localStorage.removeItem(GROUP_CHANNEL_SORT_STORAGE_KEY);

        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                GroupsViewComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        }).compileComponents();

        createComponent();
    });

    afterEach(() => {
        fixture.destroy();
        localStorage.removeItem(GROUP_CHANNEL_SORT_STORAGE_KEY);
    });

    function createComponent(
        overrides: Partial<{
            activeChannelUrl: string | undefined;
            favoriteIds: Set<string>;
            groupedChannels: Record<string, Channel[]>;
            hiddenGroupTitles: string[];
            progressTick: number;
            searchTerm: string;
            sidebarWidth: number | null;
            shouldShowEpg: boolean;
        }> = {}
    ): void {
        fixture = TestBed.createComponent(GroupsViewComponent);
        component = fixture.componentInstance;
        setInputs(overrides);
    }

    function setInputs(
        overrides: Partial<{
            activeChannelUrl: string | undefined;
            favoriteIds: Set<string>;
            groupedChannels: Record<string, Channel[]>;
            hiddenGroupTitles: string[];
            progressTick: number;
            searchTerm: string;
            sidebarWidth: number | null;
            shouldShowEpg: boolean;
        }> = {}
    ): void {
        fixture.componentRef.setInput(
            'groupedChannels',
            overrides.groupedChannels ?? groupedChannels
        );
        fixture.componentRef.setInput('searchTerm', overrides.searchTerm ?? '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput(
            'progressTick',
            overrides.progressTick ?? 0
        );
        fixture.componentRef.setInput(
            'shouldShowEpg',
            overrides.shouldShowEpg ?? true
        );
        fixture.componentRef.setInput(
            'activeChannelUrl',
            overrides.activeChannelUrl
        );
        fixture.componentRef.setInput(
            'favoriteIds',
            overrides.favoriteIds ?? new Set<string>()
        );
        fixture.componentRef.setInput(
            'hiddenGroupTitles',
            overrides.hiddenGroupTitles ?? []
        );
        fixture.componentRef.setInput(
            'sidebarWidth',
            overrides.sidebarWidth ?? 460
        );
        fixture.detectChanges();
    }

    it('sorts groups with numeric buckets before alphabetic buckets', () => {
        setInputs({
            groupedChannels: {
                'Group 10': [sportsCenter],
                'Group 2': [movieClassic],
                Alpha: [scienceNow],
            },
        });

        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Group 2',
            'Group 10',
            'Alpha',
        ]);
    });

    it('defaults to server order when no saved sort mode exists', () => {
        expect(component.groupChannelSortMode()).toBe('server');
        expect(component.groupChannelSortLabel()).toBe('Server Order');
    });

    it('restores a saved valid sort mode and ignores invalid stored values', () => {
        fixture.destroy();
        localStorage.setItem(GROUP_CHANNEL_SORT_STORAGE_KEY, 'name-asc');
        createComponent();

        expect(component.groupChannelSortMode()).toBe('name-asc');
        expect(component.groupChannelSortLabel()).toBe('Name A-Z');

        fixture.destroy();
        localStorage.setItem(GROUP_CHANNEL_SORT_STORAGE_KEY, 'invalid');
        createComponent();

        expect(component.groupChannelSortMode()).toBe('server');
    });

    it('persists sort mode changes', () => {
        component.setGroupChannelSortMode('name-desc');

        expect(component.groupChannelSortMode()).toBe('name-desc');
        expect(localStorage.getItem(GROUP_CHANNEL_SORT_STORAGE_KEY)).toBe(
            'name-desc'
        );
    });

    it('sorts selected group channels by server order, name ascending, and name descending', () => {
        const alphaSignal = createChannel(
            'sort-1',
            'Alpha Signal',
            'http://example.com/alpha-signal.m3u8',
            'Sorted'
        );
        const zuluVision = createChannel(
            'sort-2',
            'Zulu Vision',
            'http://example.com/zulu-vision.m3u8',
            'Sorted'
        );
        const middleNews = createChannel(
            'sort-3',
            'Middle News',
            'http://example.com/middle-news.m3u8',
            'Sorted'
        );

        setInputs({
            groupedChannels: {
                Sorted: [zuluVision, alphaSignal, middleNews],
            },
        });

        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['Zulu Vision', 'Alpha Signal', 'Middle News']);

        component.setGroupChannelSortMode('name-asc');
        fixture.detectChanges();
        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['Alpha Signal', 'Middle News', 'Zulu Vision']);

        component.setGroupChannelSortMode('name-desc');
        fixture.detectChanges();
        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['Zulu Vision', 'Middle News', 'Alpha Signal']);
    });

    it('prefers the active channel group for initial selection', () => {
        setInputs({ activeChannelUrl: worldUpdate.url });

        expect(component.selectedGroupKey()).toBe('News');
        expect(component.selectedGroup()?.key).toBe('News');
    });

    it('retains a visible manual selection and falls back to the first visible group', () => {
        component.selectGroup('Movies');
        fixture.detectChanges();

        setInputs({
            activeChannelUrl: sportsCenter.url,
            searchTerm: 'movie',
        });
        expect(component.selectedGroupKey()).toBe('Movies');

        setInputs({
            activeChannelUrl: sportsCenter.url,
            searchTerm: 'science',
        });
        expect(component.selectedGroupKey()).toBe('Series');
    });

    it('switches selection to the active channel group when playback changes', () => {
        component.selectGroup('Movies');
        fixture.detectChanges();

        setInputs({ activeChannelUrl: sportsCenter.url });
        expect(component.selectedGroupKey()).toBe('Sports');

        setInputs({ activeChannelUrl: scienceNow.url });
        expect(component.selectedGroupKey()).toBe('Series');
    });

    it('keeps group selection behavior unchanged when channel sort mode changes', () => {
        component.setGroupChannelSortMode('name-asc');
        component.selectGroup('Movies');
        fixture.detectChanges();

        setInputs({ activeChannelUrl: sportsCenter.url });

        expect(component.selectedGroupKey()).toBe('Sports');
        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Movies',
            'News',
            'Series',
            'Sports',
        ]);
    });

    it('matches group titles as full-group results and channel names as filtered results', () => {
        setInputs({ searchTerm: 'news' });

        expect(component.filteredGroups()).toEqual([
            expect.objectContaining({
                count: 2,
                key: 'News',
                titleMatches: true,
            }),
        ]);
        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['World Update', 'Daily Bulletin']);

        setInputs({ searchTerm: 'update' });

        expect(component.filteredGroups()).toEqual([
            expect.objectContaining({
                count: 1,
                key: 'News',
                titleMatches: false,
            }),
        ]);
        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['World Update']);
    });

    it('filters hidden groups from the rail and selected pane', () => {
        setInputs({
            activeChannelUrl: worldUpdate.url,
            hiddenGroupTitles: ['News', 'Sports'],
        });

        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Movies',
            'Series',
        ]);
        expect(component.selectedGroupKey()).toBe('Movies');
        expect(
            component.selectedGroupChannels().map((channel) => channel.name)
        ).toEqual(['Movie Classic']);
    });

    it('opens the manage-groups dialog with all groups and emits updated hidden titles on save', () => {
        const hiddenGroupTitlesChanged = jest.fn();
        component.hiddenGroupTitlesChanged.subscribe(hiddenGroupTitlesChanged);
        dialog.open.mockReturnValue({
            afterClosed: () => of(['News', 'Sports']),
        });

        component.openGroupManagement();

        expect(dialog.open).toHaveBeenCalledWith(
            GroupManagementDialogComponent,
            expect.objectContaining({
                data: expect.objectContaining({
                    hiddenGroupTitles: [],
                    groups: expect.arrayContaining([
                        { key: 'Movies', count: 1 },
                        { key: 'News', count: 2 },
                        { key: 'Series', count: 1 },
                        { key: 'Sports', count: 2 },
                    ]),
                }),
                maxHeight: '90vh',
                width: '500px',
            })
        );
        expect(hiddenGroupTitlesChanged).toHaveBeenCalledWith([
            'News',
            'Sports',
        ]);
    });

    it('toggles the inline group search from the header action and filters the visible groups', () => {
        const searchButton = fixture.nativeElement.querySelector(
            '.groups-nav-action--search'
        ) as HTMLButtonElement;

        searchButton.click();
        fixture.detectChanges();

        const searchInput = fixture.nativeElement.querySelector(
            '.groups-nav-search input'
        ) as HTMLInputElement | null;

        expect(searchInput).not.toBeNull();

        searchInput!.value = 'spo';
        searchInput!.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Sports',
        ]);
        expect(component.selectedGroupKey()).toBe('Sports');

        searchButton.click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.groups-nav-search input')
        ).toBeNull();
        expect(component.filteredGroups().map((group) => group.key)).toEqual([
            'Movies',
            'News',
            'Series',
            'Sports',
        ]);
    });

    it('emits channel and favorite events from the selected group pane', () => {
        const channelSelected = jest.fn();
        const favoriteToggled = jest.fn();
        const clickEvent = new MouseEvent('click');

        component.channelSelected.subscribe(channelSelected);
        component.favoriteToggled.subscribe(favoriteToggled);

        component.onChannelClick(movieClassic);
        component.onFavoriteToggle(movieClassic, clickEvent);

        expect(channelSelected).toHaveBeenCalledWith(movieClassic);
        expect(favoriteToggled).toHaveBeenCalledWith({
            channel: movieClassic,
            event: clickEvent,
        });
    });

    it('positions the context menu at the viewport click and opens channel details from the selected group pane', async () => {
        const openMenuSpy = jest
            .spyOn(component.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        component.onChannelContextMenu(movieClassic, {
            clientX: 212,
            clientY: 264,
        } as MouseEvent);
        await Promise.resolve();

        expect(component.contextMenuChannel()).toBe(movieClassic);
        expect(component.contextMenuPosition()).toEqual({
            x: '212px',
            y: '264px',
        });
        expect(openMenuSpy).toHaveBeenCalled();

        component.openChannelDetails();

        expect(dialog.open).toHaveBeenCalledWith(
            ChannelDetailsDialogComponent,
            expect.objectContaining({
                data: movieClassic,
                maxWidth: '720px',
                width: 'calc(100vw - 32px)',
            })
        );
    });

    it('emits total sidebar width requests while resizing the groups rail', () => {
        const requested = jest.fn();
        const committed = jest.fn();
        let contentWidth = 252;

        component.sidebarWidthRequested.subscribe(requested);
        component.sidebarWidthRequestEnded.subscribe(committed);

        const contentPanel = fixture.nativeElement.querySelector(
            '.groups-content-panel'
        ) as HTMLElement;

        jest.spyOn(contentPanel, 'getBoundingClientRect').mockImplementation(
            () =>
                ({
                    bottom: 0,
                    height: 0,
                    left: 0,
                    right: 0,
                    top: 0,
                    width: contentWidth,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                }) as DOMRect
        );

        component.onGroupsNavResizeStart();
        contentWidth = 120;

        component.onGroupsNavWidthChange(260);
        component.onGroupsNavResizeEnd(260);

        expect(requested).toHaveBeenCalledWith(512);
        expect(committed).toHaveBeenCalledWith(512);
    });

    it('keeps the layout visible for searches without matches', () => {
        setInputs({ searchTerm: 'zzz' });

        const layout = fixture.nativeElement.querySelector(
            '.groups-view-layout'
        ) as HTMLElement | null;
        const emptyState = fixture.nativeElement.querySelector(
            '.groups-content-empty-state'
        ) as HTMLElement | null;
        const manageButton = fixture.nativeElement.querySelector(
            '.groups-nav-action--manage'
        ) as HTMLButtonElement | null;

        expect(layout).not.toBeNull();
        expect(emptyState).not.toBeNull();
        expect(emptyState?.textContent).toContain('CHANNELS.NO_SEARCH_RESULTS');
        expect(manageButton).not.toBeNull();
    });

    it('renders the empty-category state when no grouped channels exist', () => {
        setInputs({ groupedChannels: {} });

        const emptyState = fixture.nativeElement.querySelector(
            '.groups-view-empty-state'
        ) as HTMLElement | null;

        expect(emptyState).not.toBeNull();
        expect(emptyState?.textContent).toContain(
            'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.TITLE'
        );
    });

    it('keeps the manage action visible when all groups are hidden', () => {
        setInputs({
            hiddenGroupTitles: ['Movies', 'News', 'Series', 'Sports'],
        });

        const layout = fixture.nativeElement.querySelector(
            '.groups-view-layout'
        ) as HTMLElement | null;
        const emptyState = fixture.nativeElement.querySelector(
            '.groups-content-empty-state'
        ) as HTMLElement | null;
        const manageButton = fixture.nativeElement.querySelector(
            '.groups-nav-action--manage'
        ) as HTMLButtonElement | null;

        expect(layout).not.toBeNull();
        expect(emptyState?.textContent).toContain('CHANNELS.NO_VISIBLE_GROUPS');
        expect(manageButton).not.toBeNull();
    });
});
