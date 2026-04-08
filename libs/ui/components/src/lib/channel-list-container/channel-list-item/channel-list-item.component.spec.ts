import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';
import { ChannelListItemComponent } from './channel-list-item.component';

describe('ChannelListItemComponent', () => {
    let fixture: ComponentFixture<ChannelListItemComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                ChannelListItemComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChannelListItemComponent);
    });

    it('formats preview times from timestamp fields when raw strings are offset', () => {
        const startTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const stopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const program: EpgProgram = {
            start: '2026-04-05 03:00:00',
            stop: '2026-04-05 03:30:00',
            channel: 'channel-1',
            title: 'Current Show',
            desc: 'Current description',
            category: null,
            startTimestamp,
            stopTimestamp,
        };

        fixture.componentRef.setInput('name', 'Cartoon Network');
        fixture.componentRef.setInput('epgProgram', program);
        fixture.componentRef.setInput('showProgramInfoButton', false);
        fixture.detectChanges();

        const times = Array.from(
            fixture.nativeElement.querySelectorAll('.epg-time'),
            (element: Element) => element.textContent?.trim() ?? ''
        );

        expect(times).toEqual([
            new Date(startTimestamp * 1000).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }),
            new Date(stopTimestamp * 1000).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }),
        ]);
    });

    it('hides the no-program placeholder for radio items without EPG data', () => {
        fixture.componentRef.setInput('name', 'Radio One');
        fixture.componentRef.setInput('showEpg', true);
        fixture.componentRef.setInput('isRadio', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.epg-placeholder')
        ).toBeNull();
    });
});
