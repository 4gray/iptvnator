/* eslint-disable @typescript-eslint/unbound-method */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChannelListContainerComponent } from './channel-list-container.component';
import { ChannelQuery } from '../../../state/channel.query';
import { ChannelStore } from '../../../state/channel.store';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MockModule } from 'ng-mocks';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { FilterPipeModule } from 'ngx-filter-pipe';
import { By } from '@angular/platform-browser';
import { createChannel } from '../../../state';
import * as MOCKED_PLAYLIST from '../../../../mocks/playlist.json';

class MatSnackBarStub {
    open(): void {}
}

describe('ChannelListContainerComponent', () => {
    let component: ChannelListContainerComponent;
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let store: ChannelStore;

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [ChannelListContainerComponent],
            providers: [
                ChannelQuery,
                { provide: MatSnackBar, useClass: MatSnackBarStub },
            ],
            imports: [
                MockModule(MatSnackBarModule),
                MockModule(MatInputModule),
                MockModule(MatIconModule),
                MockModule(MatListModule),
                MockModule(MatTabsModule),
                MockModule(MatExpansionModule),
                FormsModule,
                RouterTestingModule,
                FilterPipeModule,
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ChannelListContainerComponent);
        component = fixture.componentInstance;
        TestBed.inject(ChannelQuery);
        store = TestBed.inject(ChannelStore);
        store.update({
            favorites: [],
            playlistId: '',
            active: undefined,
        });

        // set channels
        const channels = MOCKED_PLAYLIST.playlist.items.map((element) =>
            createChannel(element)
        );
        store.upsertMany(channels);
        component.channelList = channels;

        // set favorites
        store.update({
            favorites: [MOCKED_PLAYLIST.playlist.items[0].url],
        });
        fixture.detectChanges();
    });

    it('should create component', () => {
        expect(component).toBeTruthy();
    });

    it('should render three tabs', () => {
        const tabs = fixture.debugElement.queryAll(By.css('mat-tab'));
        expect(tabs.length).toEqual(3);
    });

    it('should set channels list', () => {
        expect(component.channelList).toHaveLength(4);
    });

    it('should set groups list', () => {
        // check first group
        expect(
            component.groupedChannels[
                MOCKED_PLAYLIST.playlist.items[0].group.title
            ][0]
        ).toBeTruthy();
        expect(
            component.groupedChannels[
                MOCKED_PLAYLIST.playlist.items[0].group.title
            ][0]
        ).toEqual({
            id: MOCKED_PLAYLIST.playlist.items[0].url,
            name: MOCKED_PLAYLIST.playlist.items[0].name,
            group: MOCKED_PLAYLIST.playlist.items[0].group,
            url: MOCKED_PLAYLIST.playlist.items[0].url,
        });

        // check second group
        expect(
            component.groupedChannels[
                MOCKED_PLAYLIST.playlist.items[2].group.title
            ][0]
        ).toBeTruthy();
        expect(
            component.groupedChannels[
                MOCKED_PLAYLIST.playlist.items[2].group.title
            ][0]
        ).toEqual({
            id: MOCKED_PLAYLIST.playlist.items[2].url,
            name: MOCKED_PLAYLIST.playlist.items[2].name,
            group: MOCKED_PLAYLIST.playlist.items[2].group,
            url: MOCKED_PLAYLIST.playlist.items[2].url,
        });
    });

    it('should set favorites list', () => {
        component.favorites$.subscribe((favorites) => {
            expect(favorites).toHaveLength(1);
            expect(favorites).toStrictEqual([
                MOCKED_PLAYLIST.playlist.items[0].url,
            ]);
        });
    });

    it('should update store after channel was selected', () => {
        spyOn(store, 'update');
        component.selectChannel(component._channelList[0]);
        fixture.detectChanges();
        expect(store.update).toHaveBeenCalledTimes(1);
    });

    it('should update store after channel was favorited', () => {
        spyOn(store, 'updateFavorite');
        component.toggleFavoriteChannel(
            component._channelList[0],
            new MouseEvent('click')
        );
        fixture.detectChanges();
        expect(store.updateFavorite).toHaveBeenCalledWith(
            component._channelList[0]
        );
        expect(store.updateFavorite).toHaveBeenCalledTimes(1);
    });
});
