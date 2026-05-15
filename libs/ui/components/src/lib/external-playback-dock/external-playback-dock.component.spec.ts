import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlaybackDockComponent } from './external-playback-dock.component';

class FakeTranslateLoader implements TranslateLoader {
    getTranslation(): Observable<Record<string, unknown>> {
        return of({
            WORKSPACE: {
                SHELL: {
                    EXTERNAL_PLAYBACK_CLOSE: 'Close player',
                },
            },
        });
    }
}

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
            imports: [
                ExternalPlaybackDockComponent,
                TranslateModule.forRoot({
                    loader: {
                        provide: TranslateLoader,
                        useClass: FakeTranslateLoader,
                    },
                }),
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setDefaultLang('en');
        translate.use('en');

        fixture = TestBed.createComponent(ExternalPlaybackDockComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('session', session);
        fixture.detectChanges();
    });

    it('renders launch state copy for the active session', () => {
        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Example Video');
        expect(text).toContain('MPV');
        expect(text).toContain('Launching');
        expect(text).toContain('Close player');
    });

    it('emits a single close action when the close button is clicked', () => {
        const closeSpy = jest.fn();
        component.closeClicked.subscribe(closeSpy);

        const closeButton = fixture.debugElement.query(
            By.css('.external-playback-dock__button')
        );
        closeButton.nativeElement.click();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('renders both artwork and close as buttons', () => {
        const buttons = fixture.debugElement.queryAll(By.css('button'));
        expect(buttons).toHaveLength(2);
        expect(
            buttons[0].nativeElement.classList.contains(
                'external-playback-dock__artwork'
            )
        ).toBe(true);
        expect(
            buttons[1].nativeElement.classList.contains(
                'external-playback-dock__button'
            )
        ).toBe(true);
    });

    it('disables the artwork button when the session has no playlist target', () => {
        const artwork = fixture.debugElement.query(
            By.css('.external-playback-dock__artwork')
        );
        expect(artwork.nativeElement.disabled).toBe(true);
    });

    it('enables the artwork and emits when the session has a playlist target', () => {
        fixture.componentRef.setInput('session', {
            ...session,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 42,
                contentType: 'vod',
            },
        });
        fixture.detectChanges();

        const artworkSpy = jest.fn();
        component.artworkClicked.subscribe(artworkSpy);

        const artwork = fixture.debugElement.query(
            By.css('.external-playback-dock__artwork')
        );
        expect(artwork.nativeElement.disabled).toBe(false);
        artwork.nativeElement.click();
        expect(artworkSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to a placeholder icon when artwork fails to load', () => {
        fixture.componentRef.setInput('session', {
            ...session,
            thumbnail: 'https://example.com/broken.png',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 42,
                contentType: 'vod',
            },
        });
        fixture.detectChanges();

        const image = fixture.debugElement.query(By.css('img'));
        image.triggerEventHandler('error');
        fixture.detectChanges();

        expect(fixture.debugElement.query(By.css('img'))).toBeNull();
        expect(
            fixture.debugElement
                .query(By.css('.external-playback-dock__placeholder mat-icon'))
                .nativeElement.textContent.trim()
        ).toBe('movie');
    });
});
