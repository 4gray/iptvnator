import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { CastControlComponent } from './cast-control.component';
import { CastService } from './cast.service';

describe('CastControlComponent', () => {
    let fixture: ComponentFixture<CastControlComponent>;
    let castService: {
        discoverDlnaDevices: jest.Mock;
        openAirPlayPicker: jest.Mock;
        openRemotePlaybackPicker: jest.Mock;
        startDlnaPlayback: jest.Mock;
        startGoogleCast: jest.Mock;
        canUseGoogleCast: jest.Mock;
        supportsAirPlay: jest.Mock;
        supportsDlna: boolean;
        supportsRemotePlayback: jest.Mock;
    };

    beforeEach(async () => {
        castService = {
            discoverDlnaDevices: jest.fn().mockResolvedValue([
                {
                    id: 'renderer-1',
                    name: 'Living Room TV',
                    modelName: 'Example TV',
                },
            ]),
            openAirPlayPicker: jest.fn(),
            openRemotePlaybackPicker: jest.fn(),
            startDlnaPlayback: jest.fn(),
            startGoogleCast: jest.fn(),
            canUseGoogleCast: jest.fn().mockReturnValue(true),
            supportsAirPlay: jest.fn().mockReturnValue(true),
            supportsDlna: true,
            supportsRemotePlayback: jest.fn().mockReturnValue(true),
        };

        await TestBed.configureTestingModule({
            imports: [CastControlComponent, TranslateModule.forRoot()],
            providers: [{ provide: CastService, useValue: castService }],
        }).compileComponents();

        fixture = TestBed.createComponent(CastControlComponent);
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/live/channel.m3u8',
            title: 'Example Live',
        });
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('keeps the cast icon visible before devices are discovered', () => {
        const button = fixture.debugElement.query(
            By.css('[data-test-id="cast-control-button"]')
        );

        expect(button).not.toBeNull();
        expect(button.nativeElement.getAttribute('aria-label')).toContain(
            'CASTING.OPEN'
        );
    });

    it('uses the active media element for AirPlay and remote playback', async () => {
        const media = document.createElement('video');

        await fixture.componentInstance.openAirPlay(media);
        await fixture.componentInstance.openRemotePlayback(media);

        expect(castService.openAirPlayPicker).toHaveBeenCalledWith(media);
        expect(castService.openRemotePlaybackPicker).toHaveBeenCalledWith(
            media
        );
    });

    it('reports menu visibility so the overlay does not hide while in use', async () => {
        const menuStates: boolean[] = [];
        fixture.componentInstance.menuOpenChange.subscribe((open) =>
            menuStates.push(open)
        );

        fixture.componentInstance.handleMenuOpened();
        fixture.componentInstance.handleMenuClosed();
        await Promise.resolve();

        expect(menuStates).toEqual([true, false]);
    });

    it('discovers DLNA devices and starts direct playback on selection', async () => {
        await fixture.componentInstance.prepareMenu();
        await fixture.componentInstance.startDlnaPlayback('renderer-1');

        expect(castService.discoverDlnaDevices).toHaveBeenCalled();
        expect(castService.startDlnaPlayback).toHaveBeenCalledWith(
            'renderer-1',
            expect.objectContaining({
                streamUrl: 'https://example.com/live/channel.m3u8',
                title: 'Example Live',
            })
        );
    });
});
