import { of } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DataService, SplitAudioService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
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
    let sendIpcEvent: jest.Mock;
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
        sendIpcEvent = jest.fn().mockResolvedValue(undefined);
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
                {
                    provide: Store,
                    useValue: { select: () => of(null), dispatch: jest.fn() },
                },
                { provide: DataService, useValue: { sendIpcEvent } },
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

    it('starts an MPV window with the picture of one channel and the audio of another', async () => {
        options()[0].click();
        fixture.detectChanges();
        type('#split-audio-delay', '1.5');

        playButton().click();
        await fixture.whenStable();

        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(sendIpcEvent).toHaveBeenCalledWith(
            'OPEN_MPV_PLAYER',
            expect.objectContaining({
                url: video.url,
                title: 'Match',
                audioUrl: commentary.url,
                audioDelaySeconds: 1.5,
            })
        );
        expect(close).toHaveBeenCalledTimes(1);
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
});
