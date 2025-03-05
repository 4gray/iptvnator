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
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

jest.mock('lodash', () => {
    return {
        __esModule: true,
        default: {
            groupBy: jest.fn(() => ({})),
        },
    };
});

describe('ChannelListContainerComponent', () => {
    let component: ChannelListContainerComponent;
    let fixture: ComponentFixture<ChannelListContainerComponent>;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [
                ChannelListContainerComponent,
                FormsModule,
                MatTabsModule,
                MockModule(MatExpansionModule),
                MockModule(MatIconModule),
                MockModule(MatInputModule),
                MockModule(MatListModule),
                MockModule(MatSnackBarModule),
                MockModule(MatTooltipModule),
                MockModule(ScrollingModule),
                MockModule(TranslateModule),
                NoopAnimationsModule,
                RouterTestingModule,
            ],
            providers: [
                { provide: DataService, useClass: ElectronServiceStub },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                MockPipes(FilterPipe),
                MockProviders(NgxIndexedDBService, TranslateService),
                provideMockActions(actions$),
                provideMockStore(),
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(ChannelListContainerComponent);
        component = fixture.componentInstance;
        mockStore = TestBed.inject(MockStore);

        // set channels
        const channels = MOCKED_PLAYLIST.playlist.items.map((element) =>
            createChannel({
                ...element,
                http: {
                    ...element.http,
                    origin: '' // Add the missing 'origin' property
                }
            })
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

    it('should render three tabs', async () => {
        const tabGroup = fixture.debugElement.query(By.css('mat-tab-group'));
        expect(tabGroup).toBeTruthy();

        // Force another change detection cycle
        await fixture.whenStable();
        fixture.detectChanges();

        const tabs = tabGroup.queryAll(By.css('.mat-mdc-tab'));
        expect(tabs.length).toEqual(3);
    });

    it('should set channels list', () => {
        expect(component.channelList).toHaveLength(4);
    });

    it.skip('should set groups list', () => {
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
