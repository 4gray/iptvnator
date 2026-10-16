import { TestBed } from '@angular/core/testing';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsParentalLockSectionComponent } from './settings-parental-section.component';

describe('SettingsParentalLockSectionComponent', () => {
    it('keeps the enable switch on the saved state until the PIN action succeeds', async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsParentalLockSectionComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(
            SettingsParentalLockSectionComponent
        );
        fixture.componentRef.setInput('enabled', false);
        fixture.componentRef.setInput('unlocked', false);
        fixture.componentRef.setInput('hasPin', false);
        fixture.componentRef.setInput('relockMinutes', 15);
        fixture.componentRef.setInput('relockOptions', [0, 15]);
        fixture.detectChanges();
        const requested = jest.fn();
        fixture.componentInstance.toggleEnabled.subscribe(requested);
        const toggle = fixture.debugElement.query(By.directive(MatSlideToggle))
            .componentInstance as MatSlideToggle;
        const button = fixture.nativeElement.querySelector(
            '[data-test-id="parental-lock-enabled"] button'
        ) as HTMLButtonElement;

        // The set-PIN prompt is then cancelled: `enabled` never changes.
        button.click();
        fixture.detectChanges();

        expect(requested).toHaveBeenCalledWith(true);
        expect(toggle.checked).toBe(false);

        // The PIN was set: the switch follows the saved state.
        fixture.componentRef.setInput('enabled', true);
        fixture.detectChanges();
        expect(toggle.checked).toBe(true);
    });
});
