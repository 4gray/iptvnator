import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    FavoriteChannelFoldersService,
    type FavoriteChannelFolder,
} from '@iptvnator/portal/shared/data-access';
import {
    LiveLayoutSidebarStateService,
    type UnifiedCollectionItem,
    type UnifiedFavoriteChannel,
    WorkspaceFavoriteFoldersPanel,
} from '@iptvnator/portal/shared/util';
import { NotificationService } from '@iptvnator/services/notifications';
import { FavoriteFolderDialogs } from './favorite-folder-dialogs.service';
import { createFavoriteFoldersView } from './favorite-folders-view';

function channel(
    playlistId: string,
    xtreamId: number,
    name: string
): UnifiedCollectionItem & UnifiedFavoriteChannel {
    return {
        uid: `xtream::${playlistId}::live:${xtreamId}`,
        contentType: 'live',
        sourceType: 'xtream',
        playlistId,
        playlistName: playlistId,
        xtreamId,
        name,
        logo: null,
        addedAt: '2026-01-01T00:00:00Z',
        position: 0,
    };
}

const news = { id: 'news', name: 'News' };
const sports = { id: 'sports', name: 'Sports' };
const morning = channel('example-one', 1, 'Morning News');
const scores = channel('example-one', 2, 'Scoreboard');
const evening = channel('example-two', 1, 'Evening News');
const unavailable = channel('example-two', 2, 'Community News');
const favorites = [morning, scores, evening, unavailable];
const labels = 'WORKSPACE.FAVORITE_FOLDERS.';

@Component({
    template: `
        <button data-test-id="favorite-first-folder">
            Create first folder
        </button>
        <button data-favorite-folder-create>Create folder</button>
        <button data-favorite-folder-drawer-toggle>Open folder drawer</button>
        <button data-favorite-folder-hide>Hide folders</button>
        <button data-test-id="favorite-show-folders">Show folders</button>
        <button data-test-id="favorite-folder-heading">Channel list</button>
        <button data-test-id="favorite-folder-actions">Folder actions</button>
        <button data-favorite-folder-row="news">News</button>
        <button data-favorite-folder-row="sports">Sports</button>
        <button data-favorite-folder-row="unfiled">Without folder</button>
        <label data-test-id="favorite-select-all">
            <input type="checkbox" /> Select all
        </label>
        <button class="collection-sidebar-toggle">Show channels</button>
    `,
})
class TestHost {
    readonly enabled = signal(true);
    readonly active = signal(true);
    readonly items = signal<UnifiedCollectionItem[]>(favorites);
    readonly search = signal('');
    readonly view = createFavoriteFoldersView(this);
}

function mediaQuery(matches: boolean, media: string): MediaQueryList {
    return Object.assign(new EventTarget(), {
        matches,
        media,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
    });
}

describe('favorite folders view', () => {
    let fixture: ComponentFixture<TestHost>;
    let host: TestHost;
    let view: TestHost['view'];
    let panel: WorkspaceFavoriteFoldersPanel;

    const folders = signal<FavoriteChannelFolder[]>([]);
    const assignments = signal<Record<string, string>>({});
    const store = {
        folders,
        folderOf: (item: UnifiedCollectionItem) => assignments()[item.uid],
        canFile: (item: UnifiedCollectionItem) => item.uid !== unavailable.uid,
        hasAssignments: (id: string) =>
            Object.values(assignments()).includes(id),
        load: jest.fn(),
        move: jest.fn(),
    };
    const dialogs = {
        create: jest.fn(),
        rename: jest.fn(),
        remove: jest.fn(),
        move: jest.fn(),
    };
    const folded = signal(false);
    const sidebar = {
        isCollapsedFor: () => folded,
        expand: jest.fn(() => folded.set(false)),
        setState: jest.fn((_surface: string, state: string) =>
            folded.set(state === 'collapsed')
        ),
    };
    const error = jest.fn();
    const originalMatchMedia = window.matchMedia;
    const originalElementFromPoint = document.elementFromPoint;
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
    const desktopQuery = '(min-width: 641px) and (pointer: fine)';
    const phoneQuery = '(max-width: 640px)';
    let desktopMedia: MediaQueryList;
    let phoneMedia: MediaQueryList;

    beforeEach(() => {
        jest.clearAllMocks();
        folders.set([]);
        assignments.set({});
        folded.set(false);
        desktopMedia = mediaQuery(true, desktopQuery);
        phoneMedia = mediaQuery(false, phoneQuery);
        window.matchMedia = jest.fn((query) =>
            query === desktopQuery ? desktopMedia : phoneMedia
        );
        document.elementFromPoint = jest.fn();
        Object.defineProperty(globalThis, 'CSS', {
            configurable: true,
            value: { escape: (value: string) => value },
        });
        store.load.mockResolvedValue(undefined);
        store.move.mockResolvedValue(undefined);
        dialogs.create.mockResolvedValue(null);
        dialogs.rename.mockResolvedValue(false);
        dialogs.remove.mockResolvedValue(false);
        dialogs.move.mockResolvedValue(false);

        TestBed.configureTestingModule({
            imports: [TestHost],
            providers: [
                { provide: FavoriteChannelFoldersService, useValue: store },
                { provide: FavoriteFolderDialogs, useValue: dialogs },
                { provide: LiveLayoutSidebarStateService, useValue: sidebar },
                { provide: NotificationService, useValue: { error } },
            ],
        });
        fixture = TestBed.createComponent(TestHost);
        host = fixture.componentInstance;
        view = host.view;
        panel = TestBed.inject(WorkspaceFavoriteFoldersPanel);
    });

    afterEach(() => {
        fixture.destroy();
        window.matchMedia = originalMatchMedia;
        document.elementFromPoint = originalElementFromPoint;
        if (originalCss) {
            Object.defineProperty(globalThis, 'CSS', originalCss);
        } else {
            Reflect.deleteProperty(globalThis, 'CSS');
        }
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    function panelState() {
        const state = panel.state();
        if (!state) throw new Error('Expected an active folder panel');
        return state;
    }

    function focusable(selector: string): HTMLElement {
        const root: HTMLElement = fixture.nativeElement;
        const element = root.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing focus target: ${selector}`);
        const rect = new DOMRect(0, 0, 20, 20);
        jest.spyOn(element, 'getClientRects').mockReturnValue(
            Object.assign([rect], { item: () => rect })
        );
        return element;
    }

    function setDestination(id: string): void {
        const destination = document.createElement('button');
        const icon = document.createElement('span');
        destination.dataset['favoriteFolderTarget'] = id;
        destination.append(icon);
        jest.mocked(document.elementFromPoint).mockReturnValue(icon);
    }

    it('keeps the old favorites in their source order and opens the panel only after the first folder is saved', async () => {
        folded.set(true);
        fixture.detectChanges();
        const create = focusable('[data-favorite-folder-create]');
        const first = focusable('[data-test-id="favorite-first-folder"]');
        first.focus();

        expect(view.folderItems()).toEqual(favorites);
        expect(panel.state()).toBeNull();
        expect(view.canDragToFolder()).toBe(false);
        await view.create();
        fixture.detectChanges();
        expect(document.activeElement).toBe(first);
        expect(sidebar.expand).not.toHaveBeenCalled();

        dialogs.create.mockImplementationOnce(async () => {
            folders.set([news]);
            return news.id;
        });
        await view.create();
        fixture.detectChanges();

        expect(sidebar.expand).toHaveBeenCalledWith('favorite-folders');
        expect(view.panelFolded()).toBe(false);
        expect(view.folderItems()).toEqual(favorites);
        expect(panelState().selectedId).toBe('all');
        expect(panelState().entries).toEqual([
            { id: 'all', labelKey: labels + 'ALL_CHANNELS', count: 4 },
            { id: 'unfiled', labelKey: labels + 'WITHOUT_FOLDER', count: 4 },
            { ...news, count: 0 },
        ]);
        expect(document.activeElement).toBe(create);
    });

    it('keeps an already collapsed panel closed when creating another folder', async () => {
        folders.set([news]);
        folded.set(true);
        fixture.detectChanges();
        const drawer = focusable('[data-favorite-folder-drawer-toggle]');
        dialogs.create.mockImplementationOnce(async () => {
            folders.set([news, sports]);
            return sports.id;
        });

        panelState().onCreate();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(view.panelFolded()).toBe(true);
        expect(sidebar.expand).not.toHaveBeenCalled();
        expect(panelState().entries).toContainEqual({ ...sports, count: 0 });
        expect(document.activeElement).toBe(drawer);
    });

    it('counts search matches in each folder and preserves the full folder order', () => {
        folders.set([news, sports]);
        assignments.set({ [morning.uid]: news.id, [scores.uid]: news.id });
        host.search.set(' NEWS ');
        fixture.detectChanges();

        expect(
            panelState().entries.map(({ id, count }) => [id, count])
        ).toEqual([
            ['all', 3],
            ['unfiled', 2],
            [news.id, 1],
            [sports.id, 0],
        ]);
        expect(view.visibleCount()).toBe(3);
        expect(view.selectableCount()).toBe(2);

        panelState().onSelect(news.id);
        fixture.detectChanges();
        expect(view.currentFolder()).toEqual(news);
        expect(view.folderItems()).toEqual([morning, scores]);
        expect(view.visibleCount()).toBe(1);
        expect(view.hasFolderAssignments()).toBe(true);

        panelState().onSelect(sports.id);
        fixture.detectChanges();
        expect(view.folderItems()).toEqual([]);
        expect(view.hasFolderAssignments()).toBe(false);

        view.selectUnfiled();
        fixture.detectChanges();
        expect(view.headingKey()).toBe(labels + 'WITHOUT_FOLDER');
        expect(view.folderItems()).toEqual([evening, unavailable]);
        expect(view.canFile(unavailable)).toBe(false);

        panelState().onSelect('missing-folder');
        fixture.detectChanges();
        expect(panelState().selectedId).toBe('all');
        expect(view.headingKey()).toBe(labels + 'ALL_CHANNELS');
        expect(view.folderItems()).toEqual(favorites);
    });

    it('renames the context menu folder without changing the active folder', async () => {
        folders.set([news, sports]);
        fixture.detectChanges();
        panelState().onSelect(news.id);
        const row = focusable('[data-favorite-folder-row="sports"]');
        const actions = focusable('[data-test-id="favorite-folder-actions"]');

        dialogs.rename.mockImplementationOnce(async () => {
            folders.set([news, { ...sports, name: 'Live scores' }]);
            return true;
        });
        panelState().onRename(sports.id);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(dialogs.rename).toHaveBeenLastCalledWith(sports);
        expect(view.currentFolder()).toEqual(news);
        expect(panelState().entries).toContainEqual({
            ...sports,
            name: 'Live scores',
            count: 0,
        });
        expect(document.activeElement).toBe(row);

        dialogs.rename.mockResolvedValueOnce(true);
        await view.rename();
        fixture.detectChanges();
        expect(dialogs.rename).toHaveBeenLastCalledWith(news);
        expect(document.activeElement).toBe(actions);
        await view.rename('missing-folder');
        expect(dialogs.rename).toHaveBeenCalledTimes(2);
    });

    it('keeps the active folder on cancel, frees its channels on removal and returns to the flat list after the last deletion', async () => {
        folders.set([news, sports]);
        assignments.set({ [morning.uid]: news.id, [scores.uid]: sports.id });
        fixture.detectChanges();
        panelState().onSelect(news.id);
        fixture.detectChanges();
        const newsRow = focusable('[data-favorite-folder-row="news"]');
        const unfiledRow = focusable('[data-favorite-folder-row="unfiled"]');
        const first = focusable('[data-test-id="favorite-first-folder"]');

        await view.remove(news.id);
        fixture.detectChanges();
        expect(panelState().selectedId).toBe(news.id);
        expect(document.activeElement).toBe(newsRow);

        dialogs.remove.mockImplementationOnce(async () => {
            folders.set([sports]);
            assignments.set({ [scores.uid]: sports.id });
            return true;
        });
        panelState().onRemove(news.id);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(panelState().selectedId).toBe('unfiled');
        expect(view.folderItems()).toEqual([morning, evening, unavailable]);
        expect(document.activeElement).toBe(unfiledRow);

        panelState().onSelect(sports.id);
        dialogs.remove.mockImplementationOnce(async () => {
            folders.set([]);
            assignments.set({});
            return true;
        });
        await view.remove();
        fixture.detectChanges();
        expect(dialogs.remove).toHaveBeenLastCalledWith(sports);
        expect(panel.state()).toBeNull();
        expect(view.headingKey()).toBe(labels + 'ALL_CHANNELS');
        expect(view.folderItems()).toEqual(favorites);
        expect(document.activeElement).toBe(first);

        await view.remove();
        expect(dialogs.remove).toHaveBeenCalledTimes(3);
    });

    it('limits bulk moves to visible fileable channels and preserves selection until the move succeeds', async () => {
        folders.set([news]);
        fixture.detectChanges();
        const all = focusable('[data-test-id="favorite-select-all"] input');
        const heading = focusable('[data-test-id="favorite-folder-heading"]');
        view.beginSelection();
        fixture.detectChanges();

        expect(document.activeElement).toBe(all);
        expect(view.canDragToFolder()).toBe(false);
        await view.moveSelection();
        expect(dialogs.move).not.toHaveBeenCalled();

        view.toggleAll(true);
        expect(view.selectedUids()).toEqual(
            new Set([morning.uid, scores.uid, evening.uid])
        );
        view.toggleSelected(scores.uid);
        expect(view.selectedCount()).toBe(2);
        view.toggleSelected(scores.uid);
        expect(view.selectedCount()).toBe(3);
        view.toggleAll(false);
        expect(view.selectedCount()).toBe(0);

        view.toggleAll(true);
        host.search.set('news');
        fixture.detectChanges();
        expect(view.selectedUids()).toEqual(
            new Set([morning.uid, evening.uid])
        );
        await view.moveSelection();
        expect(dialogs.move).toHaveBeenLastCalledWith([morning, evening]);
        expect(view.selectionMode()).toBe(true);
        expect(view.selectedCount()).toBe(2);

        dialogs.move.mockResolvedValueOnce(true);
        await view.moveSelection();
        fixture.detectChanges();
        expect(view.selectionMode()).toBe(false);
        expect(view.selectedUids().size).toBe(0);
        expect(view.canDragToFolder()).toBe(true);
        expect(document.activeElement).toBe(heading);
    });

    it('restores focus to the list when a saved channel moves out of its active view', async () => {
        folders.set([news]);
        fixture.detectChanges();
        const heading = focusable('[data-test-id="favorite-folder-heading"]');
        const actions = focusable('[data-test-id="favorite-folder-actions"]');
        view.selectUnfiled();
        fixture.detectChanges();
        expect(document.activeElement).toBe(heading);

        actions.focus();
        await view.moveOne(morning);
        fixture.detectChanges();
        expect(document.activeElement).toBe(actions);

        dialogs.move.mockImplementationOnce(async () => {
            assignments.set({ [morning.uid]: news.id });
            return true;
        });
        await view.moveOne(morning);
        fixture.detectChanges();
        expect(dialogs.move).toHaveBeenLastCalledWith([morning]);
        expect(view.folderItems()).toEqual([scores, evening, unavailable]);
        expect(document.activeElement).toBe(heading);

        host.items.set([scores, evening, unavailable]);
        await view.moveOne(morning);
        expect(dialogs.move).toHaveBeenCalledTimes(2);
    });

    it('clears temporary state on leaving Live while retaining the active folder on return', () => {
        folders.set([news, sports]);
        assignments.set({ [morning.uid]: news.id });
        fixture.detectChanges();
        panelState().onSelect(news.id);
        view.startDrag(morning);
        setDestination(sports.id);
        view.updateDrag(new MouseEvent('mousemove'));
        view.beginSelection();
        view.toggleSelected(morning.uid);
        fixture.detectChanges();
        expect(panelState().dragTargetId).toBe(sports.id);
        expect(view.selectedCount()).toBe(1);

        host.active.set(false);
        fixture.detectChanges();
        expect(panel.state()).toBeNull();
        expect(view.selectionMode()).toBe(false);
        expect(view.selectedUids().size).toBe(0);

        host.active.set(true);
        fixture.detectChanges();
        expect(panelState().selectedId).toBe(news.id);
        expect(panelState().dragOriginId).toBeNull();
        expect(panelState().dragTargetId).toBeNull();

        fixture.destroy();
        expect(panel.state()).toBeNull();
    });

    it('focuses the folder rail controls after toggling the panel', () => {
        folders.set([news]);
        fixture.detectChanges();
        const show = focusable('[data-test-id="favorite-show-folders"]');
        const hide = focusable('[data-favorite-folder-hide]');
        const sidebarToggle = focusable('.collection-sidebar-toggle');

        panelState().onCollapse();
        fixture.detectChanges();
        expect(sidebar.setState).toHaveBeenLastCalledWith(
            'favorite-folders',
            'collapsed'
        );
        expect(view.canDragToFolder()).toBe(false);
        expect(document.activeElement).toBe(show);

        view.showPanel();
        fixture.detectChanges();
        expect(view.canDragToFolder()).toBe(true);
        expect(document.activeElement).toBe(hide);
        view.focusSidebarToggle();
        fixture.detectChanges();
        expect(document.activeElement).toBe(sidebarToggle);
    });

    it('moves a desktop drop to its highlighted folder and clears the confirmation after the flash', async () => {
        jest.useFakeTimers();
        folders.set([news, sports]);
        assignments.set({ [morning.uid]: news.id });
        fixture.detectChanges();
        const event = new MouseEvent('mousemove', { clientX: 12, clientY: 24 });
        view.startDrag(morning);
        setDestination(sports.id);
        view.updateDrag(event);
        fixture.detectChanges();
        expect(document.elementFromPoint).toHaveBeenCalledWith(12, 24);
        expect(panelState().dragOriginId).toBe(news.id);
        expect(panelState().dragTargetId).toBe(sports.id);

        await view.endDrag(morning, view.destinationAt(event));
        fixture.detectChanges();
        expect(store.move).toHaveBeenCalledWith([morning], sports.id);
        expect(panelState().dragOriginId).toBeNull();
        expect(panelState().dragTargetId).toBeNull();
        expect(panelState().flashedId).toBe(sports.id);

        jest.advanceTimersByTime(420);
        fixture.detectChanges();
        expect(panelState().flashedId).toBeNull();
    });

    it('rejects invalid desktop drag targets and touch drops, then reports a failed unfiled drop', async () => {
        folders.set([news]);
        assignments.set({ [morning.uid]: news.id });
        fixture.detectChanges();
        const event = new MouseEvent('mousemove');
        view.startDrag(unavailable);
        setDestination(news.id);
        expect(view.destinationAt(event)).toBeNull();

        view.startDrag(morning);
        for (const id of [news.id, 'all', 'missing-folder']) {
            setDestination(id);
            expect(view.destinationAt(event)).toBeNull();
        }
        jest.mocked(document.elementFromPoint).mockReturnValue(null);
        expect(view.destinationAt(event)).toBeNull();

        setDestination('unfiled');
        expect(view.destinationAt(new TouchEvent('touchmove'))).toBeNull();
        expect(view.destinationAt(event)).toBe('unfiled');
        await view.endDrag(morning, null);
        expect(store.move).not.toHaveBeenCalled();

        view.startDrag(morning);
        store.move.mockRejectedValueOnce(new Error('Write failed'));
        await view.endDrag(morning, view.destinationAt(event));
        fixture.detectChanges();
        expect(store.move).toHaveBeenCalledWith([morning], null);
        expect(error).toHaveBeenCalledWith(labels + 'SAVE_FAILED');
        expect(panelState().flashedId).toBeNull();

        host.items.set([scores, evening, unavailable]);
        await view.endDrag(morning, 'unfiled');
        expect(store.move).toHaveBeenCalledTimes(1);
    });

    it('updates drag eligibility and phone layout when the media queries change', () => {
        const stopDesktop = jest.spyOn(desktopMedia, 'removeEventListener');
        const stopPhone = jest.spyOn(phoneMedia, 'removeEventListener');
        folders.set([news]);
        fixture.detectChanges();
        const event = new MouseEvent('mousemove');
        setDestination(news.id);
        view.startDrag(evening);
        expect(view.destinationAt(event)).toBe(news.id);
        expect(view.canDragToFolder()).toBe(true);
        expect(view.phoneLayout()).toBe(false);

        desktopMedia.dispatchEvent(
            Object.assign(new Event('change'), { matches: false })
        );
        phoneMedia.dispatchEvent(
            Object.assign(new Event('change'), { matches: true })
        );
        expect(view.phoneLayout()).toBe(true);
        expect(view.canDragToFolder()).toBe(false);
        expect(view.destinationAt(event)).toBeNull();

        fixture.destroy();
        expect(stopDesktop).toHaveBeenCalledWith(
            'change',
            expect.any(Function)
        );
        expect(stopPhone).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('keeps channels outside a reordered folder in their original positions', () => {
        folders.set([news]);
        assignments.set({ [morning.uid]: news.id, [evening.uid]: news.id });
        fixture.detectChanges();
        panelState().onSelect(news.id);

        expect(view.folderItems()).toEqual([morning, evening]);
        expect(view.mergeReorderedItems([evening, morning])).toEqual([
            evening,
            scores,
            morning,
            unavailable,
        ]);
        expect(host.items()).toEqual(favorites);
    });

    it('reports folder-load failures and skips the store on the disabled surface', async () => {
        host.enabled.set(false);
        fixture.detectChanges();
        expect(view.isLoading()).toBe(false);
        await view.load();
        expect(store.load).not.toHaveBeenCalled();

        host.enabled.set(true);
        folders.set([news]);
        store.load.mockRejectedValueOnce(new Error('Read failed'));
        expect(view.isLoading()).toBe(true);
        await view.load();
        fixture.detectChanges();
        expect(error).toHaveBeenCalledWith(labels + 'SAVE_FAILED');
        expect(view.isLoading()).toBe(false);
        expect(view.folderItems()).toEqual(favorites);
    });
});
