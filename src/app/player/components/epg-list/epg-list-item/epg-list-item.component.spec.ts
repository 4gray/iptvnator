/* eslint-disable @typescript-eslint/unbound-method */
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import * as moment from 'moment';
import { MockModule, MockPipe } from 'ng-mocks';
import { MomentDatePipe } from './../../../../shared/pipes/moment-date.pipe';
import { EpgProgram } from './../../../models/epg-program.model';
import { EpgItemDescriptionComponent } from './../epg-item-description/epg-item-description.component';
import { EpgListItemComponent } from './epg-list-item.component';

const EPG_PROGRAM_ITEM = {
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
};

describe('EpgListItemComponent', () => {
    let component: EpgListItemComponent;
    let fixture: ComponentFixture<EpgListItemComponent>;
    let dialog: MatDialog;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    EpgListItemComponent,
                    MockPipe(MomentDatePipe),
                    MockPipe(TranslatePipe),
                ],
                imports: [
                    MockModule(MatDialogModule),
                    MockModule(MatListModule),
                    MockModule(MatIconModule),
                    MockModule(MatTooltipModule),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgListItemComponent);
        dialog = TestBed.inject(MatDialog);
        component = fixture.componentInstance;
        component.item = EPG_PROGRAM_ITEM;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should trigger the function to open the details dialog', () => {
        jest.spyOn(dialog, 'open');
        component.showDescription({} as EpgProgram);
        expect(dialog.open).toHaveBeenCalledTimes(1);
        expect(dialog.open).toHaveBeenCalledWith(EpgItemDescriptionComponent, {
            data: {},
        });
    });
});
