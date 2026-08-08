import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { SettingsStore } from '@iptvnator/services';
import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlaybackDockComponent } from './external-playback-dock.component';

class FakeTranslateLoader implements TranslateLoader {
    getTranslation(): Observable<Record<string, unknown>> {
        return of({
            WORKSPACE: {
                SHELL: {
                    EXTERNAL_PLAYBACK_CLOSE: 'Close player',
                    EXTERNAL_PLAYBACK_DISMISS: 'Dismiss',
                    EXTERNAL_PLAYBACK_OPENING: 'Opening player…',
                    EXTERNAL_PLAYBACK_STARTED: 'Player started',
                    EXTERNAL_PLAYBACK_PLAYING: 'Playing',
                    EXTERNAL_PLAYBACK_FAILED: 'External player error',
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
        expect(text).toContain('Opening player');
        expect(text).toContain('Close player');
        expect(
            fixture.nativeElement
                .querySelector('.external-playback-dock')
                .getAttribute('aria-busy')
        ).toBe('true');
        expect(
            fixture.nativeElement
                .querySelector('.external-playback-dock__status')
                .getAttribute('aria-live')
        ).toBe('polite');
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

    it.each([
        ['opened', 'Player started'],
        ['playing', 'Playing'],
    ] as const)('renders exact %s status copy', (status, expected) => {
        fixture.componentRef.setInput('session', { ...session, status });
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(expected);
        expect(
            fixture.nativeElement
                .querySelector('.external-playback-dock')
                .getAttribute('aria-busy')
        ).toBeNull();
    });

    it('keeps a failed session visible with a safe dismiss action and no retry', () => {
        const dismissSpy = jest.fn();
        component.dismissClicked.subscribe(dismissSpy);
        fixture.componentRef.setInput('session', {
            ...session,
            status: 'error',
            error: '',
            canClose: false,
        });
        fixture.detectChanges();

        const action = fixture.debugElement.query(
            By.css('.external-playback-dock__button')
        );
        expect(fixture.nativeElement.textContent).toContain(
            'External player error'
        );
        expect(action.nativeElement.textContent).toContain('Dismiss');
        expect(action.nativeElement.textContent).not.toContain('Retry');
        expect(action.nativeElement.getAttribute('aria-label')).toBe('Dismiss');

        action.nativeElement.click();
        expect(dismissSpy).toHaveBeenCalledTimes(1);
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

    describe('with strip country prefix enabled', () => {
        beforeEach(async () => {
            TestBed.resetTestingModule();
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
                providers: [
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(true) },
                    },
                ],
            }).compileComponents();

            fixture = TestBed.createComponent(ExternalPlaybackDockComponent);
        });

        it('strips the prefix from live session titles', () => {
            fixture.componentRef.setInput('session', {
                ...session,
                title: 'US | CNN',
            });
            fixture.detectChanges();

            expect(
                fixture.nativeElement
                    .querySelector('.external-playback-dock__title')
                    .textContent.trim()
            ).toBe('CNN');
        });

        it('keeps VOD/episode titles untouched', () => {
            fixture.componentRef.setInput('session', {
                ...session,
                title: 'US | Some Movie',
                contentInfo: {
                    playlistId: 'playlist-1',
                    contentXtreamId: 42,
                    contentType: 'vod',
                },
            });
            fixture.detectChanges();

            expect(
                fixture.nativeElement
                    .querySelector('.external-playback-dock__title')
                    .textContent.trim()
            ).toBe('US | Some Movie');
        });
    });
});
