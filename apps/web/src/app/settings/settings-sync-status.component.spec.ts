import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';

describe('localized synchronization status', () => {
    it('updates a readable timestamp when the UI language changes and accepts both runtime date types', async () => {
        await TestBed.configureTestingModule({
            imports: [SettingsSyncStatusComponent, TranslateModule.forRoot()],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.use('en');
        const fixture = TestBed.createComponent(SettingsSyncStatusComponent);
        const time = Date.UTC(2026, 9, 31, 15, 42);
        fixture.componentRef.setInput('state', 'connected');
        fixture.componentRef.setInput(
            'stateKey',
            'SOURCE_SYNC.STATE_connected'
        );
        fixture.componentRef.setInput('testId', 'status');
        fixture.componentRef.setInput('lastSync', time);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('time').textContent
        ).toContain('Oct 31, 2026');
        translate.use('de');
        fixture.componentRef.setInput('lastSync', new Date(time));
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('time').textContent
        ).toContain('31. Okt. 2026');
        expect(fixture.nativeElement.querySelector('time').dateTime).toBe(
            new Date(time).toISOString()
        );
        fixture.componentRef.setInput('lastSync', new Date(NaN));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('time')).toBeNull();
        TestBed.resetTestingModule();
    });
});
