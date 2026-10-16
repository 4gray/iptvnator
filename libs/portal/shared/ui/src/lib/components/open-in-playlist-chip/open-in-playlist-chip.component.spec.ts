import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { OpenInPlaylistChipComponent } from './open-in-playlist-chip.component';

const BUTTON_SELECTOR = '[data-testid="live-open-in-playlist"]';

describe('OpenInPlaylistChipComponent', () => {
    let fixture: ComponentFixture<OpenInPlaylistChipComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [OpenInPlaylistChipComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { VIEW_IN_PORTAL_TOOLTIP: 'Open in {{name}}' },
        });
        translate.use('en');

        fixture = TestBed.createComponent(OpenInPlaylistChipComponent);
        fixture.componentRef.setInput('playlistName', 'Provider A');
        fixture.detectChanges();
    });

    it('names the playlist and describes the jump in the tooltip and label', () => {
        const button = fixture.debugElement.query(By.css(BUTTON_SELECTOR));

        expect(button.nativeElement.textContent).toContain('Provider A');
        expect(button.nativeElement.getAttribute('aria-label')).toBe(
            'Open in Provider A'
        );
        expect(button.injector.get(MatTooltip).message).toBe(
            'Open in Provider A'
        );
    });

    it('emits when clicked', () => {
        const activated = jest.fn();
        fixture.componentInstance.activated.subscribe(activated);

        fixture.debugElement
            .query(By.css(BUTTON_SELECTOR))
            .nativeElement.click();

        expect(activated).toHaveBeenCalledTimes(1);
    });
});
