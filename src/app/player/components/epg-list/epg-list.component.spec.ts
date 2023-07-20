import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
/* eslint-disable @typescript-eslint/unbound-method */
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe } from '@ngx-translate/core';
import * as moment from 'moment';
import { MockComponent, MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { Observable } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import { EPG_GET_PROGRAM_DONE } from '../../../../../shared/ipc-commands';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { MomentDatePipe } from '../../../shared/pipes/moment-date.pipe';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';
import { EpgData, EpgListComponent } from './epg-list.component';

describe('EpgListComponent', () => {
    let component: EpgListComponent;
    let fixture: ComponentFixture<EpgListComponent>;
    let electronService: DataService;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    const MOCKED_PROGRAMS = {
        channel: {
            id: '12345',
            name: [
                {
                    lang: 'ab',
                    value: 'test me',
                },
                {
                    lang: 'ar',
                    value: 'ar test',
                },
            ],
            icon: [],
            url: [],
        },
        items: [
            {
                start: moment(Date.now()).format('YYYYMMDD'),
                stop: moment(Date.now()).format('YYYYMMDD'),
                channel: '12345',
                title: [{ lang: 'en', value: 'NOW on PBS' }],
                desc: [
                    {
                        lang: 'en',
                        value: "Jordan's Queen Rania has made job creation a priority to help curb the staggering unemployment rates among youths in the Middle East.",
                    },
                ],
                date: ['20080711'],
                category: [
                    { lang: 'en', value: 'Newsmagazine' },
                    { lang: 'en', value: 'Interview' },
                ],
                episodeNum: [
                    { system: 'dd_progid', value: 'EP01006886.0028' },
                    { system: 'onscreen', value: '427' },
                ],
                previouslyShown: [{ start: '20080711000000' }],
                subtitles: [{ type: 'teletext' }],
                rating: [
                    {
                        system: 'VCHIP',
                        value: 'TV-G',
                    },
                ],
                credits: [
                    {
                        role: 'actor',
                        name: 'Peter Bergman',
                    },
                ],
                icon: [
                    'http://imageswoapi.whatsonindia.com/WhatsOnTV/images/ProgramImages/xlarge/38B4DE4E9A7132257749051B6C8B4F699DB264F4V.jpg',
                ],
                audio: [],
                _attributes: {
                    start: moment(Date.now()).format('YYYYMMDD'),
                    stop: moment(Date.now()).format('YYYYMMDD'),
                },
            },
        ],
    };

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    EpgListComponent,
                    MockPipe(MomentDatePipe),
                    MockPipe(TranslatePipe),
                    MockComponent(EpgListItemComponent),
                ],
                imports: [
                    MockModule(MatIconModule),
                    MockModule(MatTooltipModule),
                    MockModule(MatListModule),
                    MockModule(MatDialogModule),
                ],
                providers: [
                    { provide: DataService, useClass: ElectronServiceStub },
                    MockProvider(MatDialog),
                    provideMockStore(),
                    provideMockActions(actions$),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgListComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);

        mockStore = TestBed.inject(MockStore);
        mockStore.setState({
            playlistState: {
                active: {
                    id: '',
                    url: '',
                    name: '',
                    group: { title: '' },
                    tvg: {
                        rec: '3',
                    },
                } as unknown as Channel,
            },
        });
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    /* it('should handle epg programs', () => {
        component.handleEpgData({ payload: MOCKED_PROGRAMS });
        fixture.detectChanges();
        expect(component.timeNow).toBeTruthy();
        expect(component.dateToday).toBeTruthy();
        expect(component.channel).toBeTruthy();
        expect(component.items).toHaveLength(1);
    }); */

    it('should handle an empty epg programs object', () => {
        const payload = {} as unknown as EpgData;
        component.handleEpgData({ payload });
        fixture.detectChanges();
        expect(component.timeNow).toBeFalsy();
        expect(component.dateToday).toBeFalsy();
        expect(component.channel).toBeNull();
        expect(component.items).toHaveLength(0);
    });

    it('should remove ipc listeners on destroy', () => {
        jest.spyOn(electronService, 'removeAllListeners');
        component.ngOnDestroy();
        expect(electronService.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(electronService.removeAllListeners).toHaveBeenCalledWith(
            EPG_GET_PROGRAM_DONE
        );
    });

    it('should set epg program as active', () => {
        jest.spyOn(mockStore, 'dispatch');
        component.setEpgProgram(MOCKED_PROGRAMS.items[0], false, true);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
        expect(mockStore.dispatch).toHaveBeenCalledWith({
            program: MOCKED_PROGRAMS.items[0],
            type: expect.stringContaining('epg program'),
        });
    });

    it('should reset active epg program', () => {
        jest.spyOn(mockStore, 'dispatch');
        component.setEpgProgram(MOCKED_PROGRAMS.items[0], true);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
        component.setEpgProgram(MOCKED_PROGRAMS.items[0], true, true);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(2);
    });
});
