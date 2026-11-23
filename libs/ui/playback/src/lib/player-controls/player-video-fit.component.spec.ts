import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { PlayerVideoFitComponent } from './player-video-fit.component';
import { videoFitModes } from './video-fit';

describe('PlayerVideoFitComponent', () => {
    let fixture: ComponentFixture<PlayerVideoFitComponent>;
    let owner: HTMLElement;

    beforeEach(() => {
        owner = document.createElement('div');
        TestBed.configureTestingModule({
            imports: [PlayerVideoFitComponent],
            providers: [provideTranslateService()],
        });
        fixture = TestBed.createComponent(PlayerVideoFitComponent);
        fixture.componentRef.setInput('surface', owner);
        fixture.componentRef.setInput('owner', owner);
    });

    afterEach(() => fixture.destroy());

    it('hides button until video exists, then exposes pressed state and translated mode labels', async () => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-test-id="player-controls-video-fit"]')).toBeNull();

        owner.innerHTML = '<video></video>';
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-test-id="player-controls-video-fit"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
        expect(fixture.nativeElement.querySelector('button')?.getAttribute('aria-label')).toContain('PLAYER_VIDEO_FIT.TITLE');
        fixture.nativeElement.querySelector('button')?.click();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(document.body.textContent).toContain('PLAYER_VIDEO_FIT.ORIGINAL');
        expect(document.body.textContent).toContain('PLAYER_VIDEO_FIT.CROP');
        expect(document.body.textContent).toContain('PLAYER_VIDEO_FIT.STRETCH');
    });

    it('persists selected mode on fullscreen owner across component remount', () => {
        videoFitModes.set(owner, 'crop');
        fixture.componentRef.setInput('surface', Object.assign(owner.cloneNode(true), { innerHTML: '<video></video>' }));
        fixture.detectChanges();
        expect(fixture.componentInstance.mode()).toBe('crop');
        expect(fixture.nativeElement.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    });
});
