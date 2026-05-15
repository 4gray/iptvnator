import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgItemDescriptionComponent } from '../epg-item-description/epg-item-description.component';
import { EpgListItemComponent } from './epg-list-item.component';

const EPG_PROGRAM_ITEM: EpgProgram = {
    start: '2026-04-05T11:30:00.000Z',
    stop: '2026-04-05T12:30:00.000Z',
    channel: '12345',
    title: 'NOW on PBS',
    desc: "Jordan's Queen Rania has made job creation a priority to help curb the staggering unemployment rates among youths in the Middle East.",
    category: 'Newsmagazine',
    episodeNum: '427',
    rating: 'TV-G',
    iconUrl:
        'http://imageswoapi.whatsonindia.com/WhatsOnTV/images/ProgramImages/xlarge/38B4DE4E9A7132257749051B6C8B4F699DB264F4V.jpg',
};

describe('EpgListItemComponent', () => {
    let component: EpgListItemComponent;
    let fixture: ComponentFixture<EpgListItemComponent>;
    let dialog: MatDialog;
    let translate: TranslateService;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [
                EpgListItemComponent,
                MockModule(MatDialogModule),
                MockModule(MatListModule),
                MockModule(MatIconModule),
                MockModule(MatTooltipModule),
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(EpgListItemComponent);
        dialog = TestBed.inject(MatDialog);
        translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                EPG: {
                    TIMESHIFT_AVAILABLE: 'Archive playback is available',
                },
                XTREAM: {
                    PLAY: 'Play',
                },
            },
            true
        );
        translate.use('en');
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
            width: '800px',
        });
    });

    it('renders an archive playback chip with replay icon and label', () => {
        fixture = TestBed.createComponent(EpgListItemComponent);
        component = fixture.componentInstance;
        component.item = EPG_PROGRAM_ITEM;
        component.showArchiveBadge = true;
        fixture.detectChanges();

        const chip = fixture.nativeElement.querySelector('.archive-playback');
        const icon = fixture.nativeElement.querySelector(
            '.archive-playback__icon'
        );

        expect(chip).not.toBeNull();
        expect(chip.textContent).toContain('Play');
        expect(icon.textContent.trim()).toBe('replay');
    });
});
