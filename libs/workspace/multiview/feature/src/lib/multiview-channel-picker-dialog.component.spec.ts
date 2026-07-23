import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { MultiviewChannelPickerDialogComponent } from './multiview-channel-picker-dialog.component';

function buildItem(
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem {
    return {
        uid: 'm3u::playlist-1::1',
        name: 'Channel One',
        contentType: 'live',
        sourceType: 'm3u',
        playlistId: 'playlist-1',
        playlistName: 'My Playlist',
        ...overrides,
    } as UnifiedCollectionItem;
}

describe('MultiviewChannelPickerDialogComponent', () => {
    let fixture: ComponentFixture<MultiviewChannelPickerDialogComponent>;
    let component: MultiviewChannelPickerDialogComponent;
    let dialogRef: { close: jest.Mock };
    let favoritesData: { getFavorites: jest.Mock };
    let recentData: { getRecentItems: jest.Mock };

    const favoriteItems = [
        buildItem({ uid: 'm3u::playlist-1::1', name: 'News HD' }),
        buildItem({
            uid: 'xtream::playlist-2::2',
            name: 'Sports One',
            sourceType: 'xtream',
            playlistId: 'playlist-2',
            playlistName: 'Xtream Portal',
        }),
        buildItem({
            uid: 'm3u::playlist-1::3',
            name: 'A Movie',
            contentType: 'movie',
        }),
        buildItem({
            uid: 'm3u::playlist-1::4',
            name: 'Radio Station',
            radio: 'true',
        }),
    ];
    const recentItems = [
        buildItem({ uid: 'stalker::playlist-3::5', name: 'Recent Live' }),
    ];

    beforeEach(async () => {
        dialogRef = { close: jest.fn() };
        favoritesData = {
            getFavorites: jest.fn().mockResolvedValue(favoriteItems),
        };
        recentData = {
            getRecentItems: jest.fn().mockResolvedValue(recentItems),
        };

        await TestBed.configureTestingModule({
            imports: [
                MultiviewChannelPickerDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                provideNoopAnimations(),
                { provide: MatDialogRef, useValue: dialogRef },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: favoritesData,
                },
                { provide: UnifiedRecentDataService, useValue: recentData },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(
            MultiviewChannelPickerDialogComponent
        );
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    });

    function itemNames(): string[] {
        return Array.from(
            fixture.nativeElement.querySelectorAll('.picker-item-name')
        ).map((el) => (el as HTMLElement).textContent?.trim());
    }

    it('loads unified favorites filtered to live non-radio channels', () => {
        expect(favoritesData.getFavorites).toHaveBeenCalledWith('all');
        expect(recentData.getRecentItems).toHaveBeenCalledWith('all');
        expect(itemNames()).toEqual(['News HD', 'Sports One']);
    });

    it('switches to the recent tab', () => {
        component.onTabChange('recent');
        fixture.detectChanges();

        expect(itemNames()).toEqual(['Recent Live']);
    });

    it('filters by search term across name and playlist name', () => {
        component.searchTerm.set('sports');
        fixture.detectChanges();
        expect(itemNames()).toEqual(['Sports One']);

        component.searchTerm.set('xtream portal');
        fixture.detectChanges();
        expect(itemNames()).toEqual(['Sports One']);

        component.searchTerm.set('no-match');
        fixture.detectChanges();
        expect(itemNames()).toEqual([]);
        expect(
            fixture.nativeElement.querySelector('.picker-empty')
        ).toBeTruthy();
    });

    it('closes with the picked item and its origin tab', () => {
        const buttons: NodeListOf<HTMLButtonElement> =
            fixture.nativeElement.querySelectorAll('.picker-item');
        buttons[1].click();

        expect(dialogRef.close).toHaveBeenCalledWith({
            item: expect.objectContaining({ name: 'Sports One' }),
            origin: 'favorites',
        });

        component.onTabChange('recent');
        fixture.detectChanges();
        const recentButton: HTMLButtonElement =
            fixture.nativeElement.querySelector('.picker-item');
        recentButton.click();

        expect(dialogRef.close).toHaveBeenLastCalledWith({
            item: expect.objectContaining({ name: 'Recent Live' }),
            origin: 'recent',
        });
    });

    it('falls back to empty lists when loading fails', async () => {
        favoritesData.getFavorites.mockRejectedValue(new Error('offline'));
        recentData.getRecentItems.mockRejectedValue(new Error('offline'));

        const failingFixture = TestBed.createComponent(
            MultiviewChannelPickerDialogComponent
        );
        failingFixture.detectChanges();
        await failingFixture.whenStable();
        failingFixture.detectChanges();

        expect(failingFixture.componentInstance.loading()).toBe(false);
        expect(failingFixture.componentInstance.filteredItems()).toEqual([]);
    });
});
