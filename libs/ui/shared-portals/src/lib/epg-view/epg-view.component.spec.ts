import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { EpgViewComponent } from './epg-view.component';

describe('EpgViewComponent', () => {
    let fixture: ComponentFixture<EpgViewComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [EpgViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EpgViewComponent);
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('renders the end timestamp when stop is absent at runtime', () => {
        fixture.componentInstance.epgItems = [
            {
                id: 'epg-1',
                epg_id: 'channel-1',
                title: 'Fallback program',
                lang: 'en',
                start: '2026-04-05T11:00:00',
                end: '2026-04-05T12:30:00',
                description: 'Program description',
                channel_id: 'channel-1',
                start_timestamp: '1775386800',
                stop_timestamp: '1775392200',
            } as EpgItem,
        ];

        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain('11:00 - 12:30');
    });
});
