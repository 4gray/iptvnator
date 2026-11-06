import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import {
    CollectionMode,
    UnifiedCollectionDataService,
} from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ConfirmDialogData, DialogService } from '@iptvnator/ui/components';
import { createClearCollectionAction } from './unified-collection-clear-action';

const recentItem: UnifiedCollectionItem = {
    uid: 'm3u::playlist-1::one',
    name: 'Channel One',
    contentType: 'live',
    sourceType: 'm3u',
    playlistId: 'playlist-1',
    playlistName: 'Playlist One',
    streamUrl: 'https://example.com/one.m3u8',
};

describe('createClearCollectionAction', () => {
    const openConfirmDialog = jest.fn();
    const data = {
        clearFavorites: jest.fn().mockResolvedValue(undefined),
        removeRecentItemsBatch: jest.fn(),
    };
    const dropCurrentType = jest.fn();

    function createAction(
        mode: CollectionMode,
        items: UnifiedCollectionItem[] = [recentItem]
    ) {
        TestBed.configureTestingModule({
            providers: [
                { provide: DialogService, useValue: { openConfirmDialog } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        return TestBed.runInInjectionContext(() =>
            createClearCollectionAction({
                mode: signal(mode),
                items: signal(items),
                typeLabelKey: signal('PORTALS.LIVE_TV'),
                isPlaylistScope: () => true,
                data: data as unknown as UnifiedCollectionDataService,
                dropCurrentType,
                reload: jest.fn().mockResolvedValue(undefined),
            })
        );
    }

    function lastDialog(): ConfirmDialogData {
        return openConfirmDialog.mock.calls.at(-1)?.[0];
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('asks once, as a destructive Clear, before removing recently viewed rows', () => {
        createAction('recent').run();

        expect(openConfirmDialog).toHaveBeenCalledTimes(1);
        expect(lastDialog()).toMatchObject({
            title: 'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_TITLE',
            message:
                'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_DIALOG_MESSAGE_PLAYLIST',
            confirmLabel: 'CLEAR',
            tone: 'destructive',
        });
        expect(dropCurrentType).not.toHaveBeenCalled();
        expect(data.removeRecentItemsBatch).not.toHaveBeenCalled();

        lastDialog().onConfirm();

        expect(dropCurrentType).toHaveBeenCalledTimes(1);
        expect(data.removeRecentItemsBatch).toHaveBeenCalledTimes(1);
        expect(data.removeRecentItemsBatch).toHaveBeenCalledWith([recentItem]);
        expect(data.clearFavorites).not.toHaveBeenCalled();
    });

    it('asks nothing when the tab on screen has no rows', () => {
        createAction('recent', []).run();

        expect(openConfirmDialog).not.toHaveBeenCalled();
        expect(data.removeRecentItemsBatch).not.toHaveBeenCalled();
    });
});
