import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injector,
    Signal,
    signal,
    untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FavoriteChannelFoldersService } from '@iptvnator/portal/shared/data-access';
import {
    deriveVisibleFavoriteChannels,
    LiveLayoutSidebarStateService,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
    WorkspaceFavoriteFoldersPanel,
} from '@iptvnator/portal/shared/util';
import { NotificationService } from '@iptvnator/services/notifications';
import { FavoriteFolderDialogs } from './favorite-folder-dialogs.service';
import { injectFavoriteFoldersFocus } from './favorite-folders-focus';

const ALL = 'all';
const UNFILED = 'unfiled';
const LABELS = 'WORKSPACE.FAVORITE_FOLDERS';

export type FavoriteFoldersView = ReturnType<typeof createFavoriteFoldersView>;

export function createFavoriteFoldersView(options: {
    enabled: Signal<boolean>;
    active: Signal<boolean>;
    items: Signal<UnifiedCollectionItem[]>;
    search: Signal<string>;
}) {
    const injector = inject(Injector);
    const document = inject(DOCUMENT);
    const notifications = inject(NotificationService);
    const panel = inject(WorkspaceFavoriteFoldersPanel, { optional: true });
    const sidebar = inject(LiveLayoutSidebarStateService);
    const panelFolded = sidebar.isCollapsedFor('favorite-folders');
    const focusAfterRender = injectFavoriteFoldersFocus();
    const destroyRef = inject(DestroyRef);
    const store = () => injector.get(FavoriteChannelFoldersService);
    const dialogs = () => injector.get(FavoriteFolderDialogs);
    const initialLoadPending = signal(true);
    const folders = computed(() =>
        options.enabled() ? store().folders() : []
    );
    const folderId = signal(ALL);
    const currentId = computed(() => {
        const id = folderId();
        const entries = folders();
        return entries.length &&
            (id === UNFILED || entries.some((folder) => folder.id === id))
            ? id
            : ALL;
    });
    const findFolder = (id: string) =>
        folders().find((folder) => folder.id === id);
    const currentFolder = computed(() => findFolder(currentId()));
    const selectionMode = signal(false);
    const selectedUids = signal<ReadonlySet<string>>(new Set());
    const dragOriginId = signal<string | null>(null);
    const dragTargetId = signal<string | null>(null);
    const flashedId = signal<string | null>(null);
    let flashTimeout: ReturnType<typeof setTimeout> | undefined;
    const watchMedia = (query: string) => {
        const media = document.defaultView?.matchMedia?.(query);
        const matches = signal(media?.matches ?? false);
        const update = (event: MediaQueryListEvent) => matches.set(event.matches);
        media?.addEventListener('change', update);
        destroyRef.onDestroy(() => media?.removeEventListener('change', update));
        return matches.asReadonly();
    };
    const desktopDrag = watchMedia('(min-width: 641px) and (pointer: fine)');
    destroyRef.onDestroy(() => {
        clearTimeout(flashTimeout);
        if (options.enabled()) panel?.clear();
    });

    const membership = computed(() => {
        if (!folders().length) return new Map<string, string>();
        return new Map(
            options
                .items()
                .map((item) => [item.uid, store().folderOf(item) ?? UNFILED])
        );
    });
    const folderItems = computed(() => {
        const id = currentId();
        const items = options.items();
        if (id === ALL) return items;
        const assignments = membership();
        return items.filter((item) => assignments.get(item.uid) === id);
    });
    const matchingItems = computed(() =>
        deriveVisibleFavoriteChannels(options.items(), {
            searchTerm: options.search(),
            sortMode: null,
            getName: (item) => item.name,
        })
    );
    const visibleItems = computed(() => {
        const id = currentId();
        const matches = matchingItems();
        if (id === ALL) return matches;
        const assignments = membership();
        return matches.filter((item) => assignments.get(item.uid) === id);
    });
    const selectableItems = computed(() =>
        visibleItems().filter((item) => store().canFile(item))
    );
    const checkedItems = computed(() => {
        const checked = selectedUids();
        return selectableItems().filter((item) => checked.has(item.uid));
    });
    const entries = computed(() => {
        const matches = matchingItems();
        const assignments = membership();
        const counts = new Map<string, number>();
        for (const item of matches) {
            const id = assignments.get(item.uid) ?? UNFILED;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return [
            {
                id: ALL,
                labelKey: LABELS + '.ALL_CHANNELS',
                count: matches.length,
            },
            {
                id: UNFILED,
                labelKey: LABELS + '.WITHOUT_FOLDER',
                count: counts.get(UNFILED) ?? 0,
            },
            ...folders().map((folder) => ({
                ...folder,
                count: counts.get(folder.id) ?? 0,
            })),
        ];
    });

    function resetSelection(): void {
        selectionMode.set(false);
        selectedUids.set(new Set());
    }

    function selectFolder(id: string): void {
        folderId.set(id);
        resetSelection();
    }

    function setPanelFolded(folded: boolean): void {
        sidebar.setState('favorite-folders', folded ? 'collapsed' : 'expanded');
        focusAfterRender(
            folded
                ? '[data-test-id="favorite-show-folders"]'
                : '[data-favorite-folder-hide]'
        );
    }

    function finishSelection(): void {
        resetSelection();
        focusAfterRender(
            '[data-test-id="favorite-folder-actions"]',
            '[data-test-id="favorite-folder-heading"]',
            '[data-test-id="favorite-first-folder"]'
        );
    }

    async function create(): Promise<void> {
        const firstFolder = !folders().length;
        if (await dialogs().create()) {
            if (firstFolder && panelFolded()) {
                sidebar.expand('favorite-folders');
            }
            focusAfterRender(
                '[data-favorite-folder-create]',
                '[data-favorite-folder-drawer-toggle]',
                '[data-test-id="favorite-folder-heading"]',
                '[data-test-id="favorite-first-folder"]'
            );
        }
    }

    function focusPanelRow(id: string): void {
        focusAfterRender(
            `[data-favorite-folder-row="${CSS.escape(id)}"]`,
            '[data-favorite-folder-drawer-toggle]',
            '[data-test-id="favorite-folder-heading"]',
            '[data-test-id="favorite-first-folder"]'
        );
    }

    async function rename(id?: string): Promise<void> {
        const folder = findFolder(id ?? currentId());
        if (!folder) return;

        const renamed = await dialogs().rename(folder);
        if (id !== undefined) {
            focusPanelRow(id);
        } else if (renamed) {
            focusAfterRender(
                '[data-test-id="favorite-folder-actions"]',
                '[data-test-id="favorite-folder-heading"]'
            );
        }
    }

    async function remove(id?: string): Promise<void> {
        const folder = findFolder(id ?? currentId());
        if (!folder) return;

        const removed = await dialogs().remove(folder);
        if (removed && folderId() === folder.id) {
            selectFolder(folders().length ? UNFILED : ALL);
        }
        if (id !== undefined) {
            focusPanelRow(removed ? currentId() : id);
        } else if (removed) {
            focusAfterRender(
                '[data-test-id="favorite-folder-heading"]',
                '[data-test-id="favorite-first-folder"]'
            );
        }
    }

    async function moveOne(channel: UnifiedFavoriteChannel): Promise<void> {
        const item = options.items().find(({ uid }) => uid === channel.uid);
        if (
            item &&
            (await dialogs().move([item])) &&
            !visibleItems().some(({ uid }) => uid === item.uid)
        ) {
            focusAfterRender('[data-test-id="favorite-folder-heading"]');
        }
    }

    async function moveSelection(): Promise<void> {
        const items = checkedItems();
        if (items.length && (await dialogs().move(items))) finishSelection();
    }

    function toggleSelected(uid: string): void {
        selectedUids.update((current) => {
            const next = new Set(current);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    }

    function destinationAt(event: MouseEvent | TouchEvent): string | null {
        if (!dragOriginId() || !desktopDrag() || 'changedTouches' in event)
            return null;
        const target = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-favorite-folder-target]')?.dataset[
            'favoriteFolderTarget'
        ];
        return target &&
            target !== dragOriginId() &&
            target !== ALL &&
            (target === UNFILED || folders().some(({ id }) => id === target))
            ? target
            : null;
    }

    function clearDrag(): void {
        dragOriginId.set(null);
        dragTargetId.set(null);
    }

    async function endDrag(
        channel: UnifiedFavoriteChannel,
        destination: string | null
    ): Promise<void> {
        clearDrag();
        if (!destination) return;
        const item = options.items().find(({ uid }) => uid === channel.uid);
        if (!item) return;

        clearTimeout(flashTimeout);
        flashedId.set(null);
        try {
            await store().move(
                [item],
                destination === UNFILED ? null : destination
            );
            clearTimeout(flashTimeout);
            flashedId.set(destination);
            flashTimeout = setTimeout(() => flashedId.set(null), 420);
        } catch {
            notifications.error(LABELS + '.SAVE_FAILED');
        }
    }

    effect(() => {
        if (!options.enabled()) return;
        if (!options.active()) {
            panel?.clear();
            untracked(() => {
                resetSelection();
                clearDrag();
            });
            return;
        }
        if (!folders().length) {
            panel?.clear();
            return;
        }
        panel?.set({
            entries: entries(),
            selectedId: currentId(),
            onSelect: selectFolder,
            onCreate: () => void create(),
            onCollapse: () => setPanelFolded(true),
            onRename: (id) => void rename(id),
            onRemove: (id) => void remove(id),
            dragOriginId: dragOriginId(),
            dragTargetId: dragTargetId(),
            flashedId: flashedId(),
        });
    });

    effect(() => {
        if (!selectionMode()) return;
        const visible = new Set(selectableItems().map(({ uid }) => uid));
        untracked(() =>
            selectedUids.update((current) =>
                [...current].some((uid) => !visible.has(uid))
                    ? new Set([...current].filter((uid) => visible.has(uid)))
                    : current
            )
        );
    });

    return {
        folders,
        folderItems,
        isLoading: computed(() => options.enabled() && initialLoadPending()),
        currentFolder,
        hasFolderAssignments: computed(() => {
            const folder = currentFolder();
            return !!folder && store().hasAssignments(folder.id);
        }),
        selectionMode,
        selectedUids,
        selectedCount: computed(() => checkedItems().length),
        visibleCount: computed(() => visibleItems().length),
        selectableCount: computed(() => selectableItems().length),
        headingKey: computed(() =>
            currentId() === UNFILED
                ? LABELS + '.WITHOUT_FOLDER'
                : LABELS + '.ALL_CHANNELS'
        ),
        canFile: (item: UnifiedFavoriteChannel) => store().canFile(item),
        canDragToFolder: computed(
            () =>
                desktopDrag() &&
                !!folders().length &&
                !panelFolded() &&
                !selectionMode()
        ),
        panelFolded,
        phoneLayout: watchMedia('(max-width: 640px)'),
        showPanel: () => setPanelFolded(false),
        startDrag: (channel: UnifiedFavoriteChannel) => {
            if (desktopDrag() && folders().length && store().canFile(channel))
                dragOriginId.set(membership().get(channel.uid) ?? UNFILED);
        },
        updateDrag: (event: MouseEvent | TouchEvent) =>
            dragTargetId.set(destinationAt(event)),
        clearDrag,
        destinationAt,
        endDrag,
        selectUnfiled: () => {
            selectFolder(UNFILED);
            focusAfterRender('[data-test-id="favorite-folder-heading"]');
        },
        beginSelection: () => {
            selectionMode.set(true);
            focusAfterRender('[data-test-id="favorite-select-all"] input');
        },
        finishSelection,
        focusSidebarToggle: () =>
            focusAfterRender('.collection-sidebar-toggle'),
        toggleSelected,
        toggleAll: (checked: boolean) =>
            selectedUids.set(
                new Set(checked ? selectableItems().map(({ uid }) => uid) : [])
            ),
        create,
        rename,
        remove,
        moveOne,
        moveSelection,
        mergeReorderedItems: (items: UnifiedCollectionItem[]) => {
            const ordered = new Set(items.map(({ uid }) => uid));
            let index = 0;
            return options
                .items()
                .map((item) => (ordered.has(item.uid) ? items[index++] : item));
        },
        load: async () => {
            if (!options.enabled()) return;
            try {
                await store().load();
            } catch {
                notifications.error(LABELS + '.SAVE_FAILED');
            } finally {
                initialLoadPending.set(false);
            }
        },
    };
}
