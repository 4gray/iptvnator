import { ScrollingModule } from '@angular/cdk/scrolling';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockModule, MockPipes, MockProviders } from 'ng-mocks';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { Observable } from 'rxjs';
import * as MOCKED_PLAYLIST from '../../../../mocks/playlist.json';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { createChannel } from '../../../shared/channel.model';
import { FilterPipe } from '../../../shared/pipes/filter.pipe';
import { ChannelListContainerComponent } from './channel-list-container.component';

class MatSnackBarStub {
    open(): void {}
}

describe('ChannelListContainerComponent', () => {
    let component: ChannelListContainerComponent;
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [
                ChannelListContainerComponent,
                MockPipes(TranslatePipe, FilterPipe),
            ],
            providers: [
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                provideMockStore(),
                provideMockActions(actions$),
                MockProviders(NgxIndexedDBService, TranslateService),
            ],
            imports: [
                MockModule(MatSnackBarModule),
                MockModule(MatInputModule),
                MockModule(MatIconModule),
                MockModule(MatListModule),
                MockModule(ScrollingModule),
                MockModule(MatTabsModule),
                MockModule(MatTooltipModule),
                MockModule(MatExpansionModule),
                FormsModule,
                RouterTestingModule,
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ChannelListContainerComponent);
        component = fixture.componentInstance;
        mockStore = TestBed.inject(MockStore);

        // set channels
        const channels = MOCKED_PLAYLIST.playlist.items.map((element) =>
            createChannel(element)
        );

        mockStore.setState({
            playlistState: {
                channels,
                active: undefined,
            },
        });
        component.channelList = channels;
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
        ).toEqual(
            expect.objectContaining({
                id: MOCKED_PLAYLIST.playlist.items[0].url,
                name: MOCKED_PLAYLIST.playlist.items[0].name,
                group: MOCKED_PLAYLIST.playlist.items[0].group,
                url: MOCKED_PLAYLIST.playlist.items[0].url,
            })
        );

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
        ).toEqual(
            expect.objectContaining({
                id: MOCKED_PLAYLIST.playlist.items[2].url,
                name: MOCKED_PLAYLIST.playlist.items[2].name,
                group: MOCKED_PLAYLIST.playlist.items[2].group,
                url: MOCKED_PLAYLIST.playlist.items[2].url,
            })
        );
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
        jest.spyOn(mockStore, 'dispatch');
        component.selectChannel(component._channelList[0]);
        fixture.detectChanges();
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should update store after channel was favorited', () => {
        jest.spyOn(mockStore, 'dispatch');
        component.toggleFavoriteChannel(
            component._channelList[0],
            new MouseEvent('click')
        );
        fixture.detectChanges();
        expect(mockStore.dispatch).toHaveBeenCalledWith({
            channel: component._channelList[0],
            type: expect.stringContaining('favorites'),
        });
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });
});
