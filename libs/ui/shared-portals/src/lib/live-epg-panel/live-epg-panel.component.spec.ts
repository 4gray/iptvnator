import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
} from './live-epg-panel.component';

@Component({
    standalone: true,
    imports: [LiveEpgPanelComponent],
    template: `
        <app-live-epg-panel
            [collapsed]="collapsed"
            [summary]="summary"
            [loading]="loading"
            [summaryLabelKey]="summaryLabelKey"
            [showDateNavigator]="showDateNavigator"
            [selectedDate]="selectedDate"
            [showReturnToLive]="showReturnToLive"
            (collapsedChange)="collapsed = $event"
            (dateNavigation)="dateDirection = $event"
            (returnToLive)="returnToLiveCount = returnToLiveCount + 1"
        >
            <div class="projected-content">Projected EPG</div>
        </app-live-epg-panel>
    `,
})
class HostComponent {
    collapsed = false;
    loading = false;
    summaryLabelKey = 'EPG.CURRENT_PROGRAM';
    showDateNavigator = false;
    showReturnToLive = false;
    selectedDate = '2026-04-05';
    dateDirection: 'next' | 'prev' | null = null;
    returnToLiveCount = 0;
    summary: LiveEpgPanelSummary | null = {
        title: 'Current Show',
        start: '2026-04-05T11:30:00.000Z',
        stop: '2026-04-05T12:30:00.000Z',
    };
}

describe('LiveEpgPanelComponent', () => {
    let fixture: ComponentFixture<HostComponent>;

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-05T12:00:00.000Z'));

        await TestBed.configureTestingModule({
            imports: [
                HostComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(HostComponent);
    });

    afterEach(() => {
        fixture.destroy();
        jest.useRealTimers();
    });

    it('renders the current program summary and progress', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__title')
                .textContent
        ).toContain('Current Show');
        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__label')
                .textContent
        ).toContain('EPG.CURRENT_PROGRAM');
        expect(
            fixture.nativeElement.querySelector(
                '.live-epg-panel__progress-fill'
            ).style.width
        ).toBe('50%');
    });

    it('emits and applies collapsed state from the toggle button', () => {
        fixture.detectChanges();

        fixture.nativeElement.querySelector('button').click();
        fixture.detectChanges();

        expect(fixture.componentInstance.collapsed).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('.live-epg-panel')
                .classList.contains('live-epg-panel--collapsed')
        ).toBe(true);
    });

    it('keeps projected EPG content mounted while collapsed and makes it inert', () => {
        fixture.componentInstance.collapsed = true;
        fixture.detectChanges();

        const body = fixture.nativeElement.querySelector(
            '.live-epg-panel__body'
        );

        expect(
            fixture.nativeElement.querySelector('.projected-content')
                .textContent
        ).toContain('Projected EPG');
        expect(body.getAttribute('aria-hidden')).toBe('true');
        expect(body.hasAttribute('inert')).toBe(true);
    });

    it('renders the fallback text when there is no current program', () => {
        fixture.componentInstance.summary = null;
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__title')
                .textContent
        ).toContain('EPG.NO_PROGRAM_INFO');
    });

    it('renders date navigation in the unified toolbar and emits day changes', () => {
        fixture.componentInstance.showDateNavigator = true;
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.selected-date').textContent
        ).toContain('April 5, Sunday');

        fixture.nativeElement.querySelector('.next-day').click();

        expect(fixture.componentInstance.dateDirection).toBe('next');
    });

    it('hides date navigation controls while collapsed', () => {
        fixture.componentInstance.collapsed = true;
        fixture.componentInstance.showDateNavigator = true;
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__date-chip')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__date-nav')
        ).toBeNull();
    });

    it('renders archive playback state and emits return-to-live requests', () => {
        fixture.componentInstance.summaryLabelKey = 'EPG.ARCHIVE_PLAYBACK';
        fixture.componentInstance.showReturnToLive = true;
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel__label')
                .textContent
        ).toContain('EPG.ARCHIVE_PLAYBACK');

        const returnButton = fixture.nativeElement.querySelector(
            '.live-epg-panel__return-live'
        ) as HTMLButtonElement | null;
        expect(returnButton).not.toBeNull();
        expect(returnButton?.textContent).toContain('EPG.RETURN_TO_LIVE');

        returnButton?.click();

        expect(fixture.componentInstance.returnToLiveCount).toBe(1);
    });
});
