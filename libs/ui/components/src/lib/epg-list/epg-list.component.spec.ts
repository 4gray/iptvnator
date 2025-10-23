/* import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MomentDatePipe } from '@iptvnator/pipes';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockComponent, MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { BehaviorSubject, Observable } from 'rxjs';
import { DataService, ElectronServiceStub, EpgService } from 'services';
import { Channel, EpgProgram } from 'shared-interfaces';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';
import { EpgListComponent } from './epg-list.component';

// Update moment mock to handle namespace import
jest.mock('moment', () => {
    const momentFunc = () => ({
        format: () => '2023-01-01',
        subtract: () => ({
            toISOString: () => '2023-01-01T00:00:00Z',
            format: () => '2023-01-01',
        }),
        diff: () => 0,
        add: () => ({
            format: () => '2023-01-01',
        }),
    });
    momentFunc.default = momentFunc;
    return momentFunc;
});

describe('EpgListComponent', () => {
    let component: EpgListComponent;
    let fixture: ComponentFixture<EpgListComponent>;
    let electronService: DataService;
    let mockStore: MockStore;
    let epgService: EpgService;
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
                start: '2023-01-01',
                stop: '2023-01-01',
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
                    start: '2023-01-01',
                    stop: '2023-01-01',
                },
            },
        ],
    };

    beforeEach(waitForAsync(() => {
        const mockEpgService = {
            currentEpgPrograms$: new BehaviorSubject<EpgProgram[]>([]),
        };

        TestBed.configureTestingModule({
            imports: [
                EpgListComponent,
                MockPipe(MomentDatePipe),
                TranslateModule.forRoot(),
                MockComponent(EpgListItemComponent),
                MockModule(MatIconModule),
                MockModule(MatTooltipModule),
                MockModule(MatListModule),
                MockModule(MatDialogModule),
            ],
            providers: [
                { provide: DataService, useClass: ElectronServiceStub },
                { provide: EpgService, useValue: mockEpgService },
                MockProvider(MatDialog),
                provideMockStore(),
                provideMockActions(actions$),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgListComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);
        epgService = TestBed.inject(EpgService);

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

    it('should handle an empty epg programs object', () => {
        const emptyPrograms: EpgProgram[] = [];
        (epgService.currentEpgPrograms$ as BehaviorSubject<EpgProgram[]>).next(
            emptyPrograms
        );
        component.handleEpgData(emptyPrograms);
        fixture.detectChanges();
        expect(component.timeNow).toBeTruthy();
        expect(component.dateToday).toBeTruthy();
        expect(component.channel).toBeNull();
        // Use async pipe or subscribe to test the Observable
        component.items$.subscribe((items) => {
            expect(items).toHaveLength(0);
        });
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
 */
