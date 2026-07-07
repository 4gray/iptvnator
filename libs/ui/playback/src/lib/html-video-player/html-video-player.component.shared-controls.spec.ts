import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent with shared controls flag ON', () => {
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
            providers: [
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('removes the native skin and renders shared controls', () => {
        const component = fixture.componentInstance;
        expect(component.sharedControls).toBe(true);
        expect(
            component.videoPlayer.nativeElement.hasAttribute('controls')
        ).toBe(false);
        expect(
            fixture.debugElement.query(By.css('app-player-controls'))
        ).not.toBeNull();
    });
});
