import { ApplicationInitStatus, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fileURLToPath } from 'node:url';
import { provideAndroidPlaybackCheckpoint } from './android-playback-checkpoint.providers';

jest.unstable_mockModule(
    fileURLToPath(new URL('./android-playback-checkpoint.ts', import.meta.url)),
    () => {
        throw new Error('Synthetic checkpoint module unavailable');
    }
);

it('starts the application when the Android checkpoint module cannot load', async () => {
    const postMessage = jest.fn();
    TestBed.configureTestingModule({
        providers: [
            provideAndroidPlaybackCheckpoint(),
            {
                provide: DOCUMENT,
                useValue: { defaultView: { TvShell: { postMessage } } },
            },
        ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    expect(postMessage).not.toHaveBeenCalled();
});
