import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { ChannelActions } from '@iptvnator/m3u-state';
import { SettingsStore, SplitAudioService } from '@iptvnator/services';
import { Channel, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    SplitAudioDialogComponent,
    SplitAudioDialogData,
} from './split-audio-dialog.component';

function channel(id: string, name: string): Channel {
    return { id, name, url: `http://host/live/${id}.ts` } as Channel;
}

describe('SplitAudioDialogComponent', () => {
    const video = channel('a', 'Match');
    const commentary = channel('b', 'Commentary');
    const news = channel('c', 'News');
    const data: SplitAudioDialogData = {
        video,
        channels: [video, commentary, news],
    };

    let fixture: ComponentFixture<SplitAudioDialogComponent>;
    let player: ReturnType<typeof signal<VideoPlayer>>;
    let dispatch: jest.Mock;
    let close: jest.Mock;
    let splitAudio: SplitAudioService;

    const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const options = (): HTMLButtonElement[] =>
        Array.from(root().querySelectorAll('.split-audio__option'));
    const playButton = (): HTMLButtonElement =>
        root().querySelector('button[mat-flat-button]') as HTMLButtonElement;

    function type(selector: string, value: string): void {
        const input = root().querySelector(selector) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
    }

    beforeEach(async () => {
        localStorage.clear();
        player = signal(VideoPlayer.MPV);
        dispatch = jest.fn();
        close = jest.fn();

        await TestBed.configureTestingModule({
            imports: [
                SplitAudioDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: data },
                { provide: MatDialogRef, useValue: { close } },
                { provide: Store, useValue: { dispatch } },
                { provide: SettingsStore, useValue: { player } },
            ],
        }).compileComponents();

        splitAudio = TestBed.inject(SplitAudioService);
        fixture = TestBed.createComponent(SplitAudioDialogComponent);
        fixture.detectChanges();
    });

    it('offers every channel except the one that provides the picture', () => {
        expect(options().map((option) => option.textContent?.trim())).toEqual([
            'Commentary',
            'News',
        ]);
    });

    it('narrows the list with the search box', () => {
        type('#split-audio-search', 'comm');

        expect(options().map((option) => option.textContent?.trim())).toEqual([
            'Commentary',
        ]);
    });

    it('cannot start before an audio channel is chosen', () => {
        expect(playButton().disabled).toBe(true);

        options()[0].click();
        fixture.detectChanges();

        expect(playButton().disabled).toBe(false);
    });

    it('starts the video channel with the chosen audio and delay, once', () => {
        options()[0].click();
        fixture.detectChanges();
        type('#split-audio-delay', '1.5');

        playButton().click();

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({
                channel: video,
                startPlayback: true,
            })
        );
        expect(close).toHaveBeenCalledTimes(1);
        // The playback launch takes the request exactly once.
        expect(splitAudio.take()).toEqual({
            streamUrl: commentary.url,
            title: 'Commentary',
            delaySeconds: 1.5,
        });
        expect(splitAudio.take()).toBeNull();
    });

    it('remembers the delay for the pair and restores it next time', () => {
        options()[0].click();
        fixture.detectChanges();
        type('#split-audio-delay', '2.25');
        playButton().click();

        expect(splitAudio.savedDelay(video.url, commentary.url)).toBe(2.25);

        // A new dialog for the same pair starts from the saved delay.
        fixture = TestBed.createComponent(SplitAudioDialogComponent);
        fixture.detectChanges();
        options()[0].click();
        fixture.detectChanges();

        const delayInput = root().querySelector(
            '#split-audio-delay'
        ) as HTMLInputElement;
        expect(Number(delayInput.value)).toBe(2.25);
    });

    it('explains and refuses when the player is not MPV', () => {
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();

        expect(root().querySelector('.split-audio__warning')).not.toBeNull();

        options()[0].click();
        fixture.detectChanges();
        expect(playButton().disabled).toBe(true);

        playButton().click();
        expect(dispatch).not.toHaveBeenCalled();
        expect(splitAudio.take()).toBeNull();
    });
});
