import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ExternalPlayerSession } from 'shared-interfaces';
import { ExternalPlaybackDockComponent } from './external-playback-dock.component';

describe('ExternalPlaybackDockComponent', () => {
    let fixture: ComponentFixture<ExternalPlaybackDockComponent>;
    let component: ExternalPlaybackDockComponent;

    const session: ExternalPlayerSession = {
        id: 'session-1',
        player: 'mpv',
        status: 'launching',
        title: 'Example Video',
        streamUrl: 'https://example.com/video.mp4',
        startedAt: '2026-03-07T10:00:00.000Z',
        updatedAt: '2026-03-07T10:00:00.000Z',
        canClose: true,
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ExternalPlaybackDockComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(ExternalPlaybackDockComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('session', session);
        fixture.detectChanges();
    });

    it('renders launch state copy for the active session', () => {
        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Example Video');
        expect(text).toContain('Opening in MPV...');
        expect(text).toContain('Close player');
    });

    it('emits close and dismiss actions', () => {
        const closeSpy = jest.fn();
        const dismissSpy = jest.fn();
        component.closeClicked.subscribe(closeSpy);
        component.dismissClicked.subscribe(dismissSpy);

        const buttons = fixture.debugElement.queryAll(By.css('button'));
        buttons[0].nativeElement.click();
        buttons[1].nativeElement.click();

        expect(closeSpy).toHaveBeenCalled();
        expect(dismissSpy).toHaveBeenCalled();
    });
});
