import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    MULTIVIEW_SOURCE_PICKER,
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
    type MultiviewSourcePicker,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { MultiviewErrorCardComponent } from './multiview-error-card.component';

function source(key: string): MultiviewTileSource {
    return {
        playback: {
            streamUrl: `https://stream.example/${key}.m3u8`,
            title: key,
        },
        playbackSessionKey: `session:${key}`,
        kind: 'live',
        playlistId: 'playlist-1',
        title: key,
    };
}

describe('MultiviewErrorCardComponent', () => {
    let fixture: ComponentFixture<MultiviewErrorCardComponent>;
    let store: MultiviewSessionStore;
    let picker: jest.Mocked<MultiviewSourcePicker>;

    beforeEach(() => {
        picker = { pick: jest.fn().mockResolvedValue(source('news')) };
        TestBed.configureTestingModule({
            imports: [MultiviewErrorCardComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.VideoJs) },
                },
                { provide: MULTIVIEW_SOURCE_PICKER, useValue: picker },
            ],
        });
        store = TestBed.inject(MultiviewSessionStore);
        TestBed.inject(MultiviewAnchorRegistry).register({
            host: {
                anchorId: 'xtream-live',
                source: signal(source('movie')),
                engine: signal(VideoPlayer.VideoJs),
            },
            element: signal(null),
        });
        store.start(
            'xtream-live',
            source('movie'),
            VideoPlayer.VideoJs,
            source('match')
        );
        fixture = TestBed.createComponent(MultiviewErrorCardComponent);
        fixture.componentRef.setInput('tile', store.tiles()[1]);
        fixture.componentRef.setInput('corner', 'top-left');
        fixture.componentRef.setInput('box', {
            left: 16,
            top: 16,
            width: 300,
            height: 169,
        });
        fixture.componentRef.setInput('stage', { width: 360, height: 600 });
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    const host = (): HTMLElement => fixture.nativeElement;

    it('grows from the tile corner and stays inside a narrow stage', () => {
        expect(host().style.left).toBe('16px');
        expect(host().style.top).toBe('16px');
        expect(host().style.right).toBe('');
        expect(host().style.width).toBe('328px');
        expect(host().getAttribute('role')).toBe('alertdialog');
        expect(host().getAttribute('aria-labelledby')).toBe(
            `mv-error-${store.tiles()[1].id}`
        );
    });

    it('opens the picker to replace the failed tile', async () => {
        const failedId = store.tiles()[1].id;
        (
            host().querySelector(
                '[data-test-id="multiview-error-choose"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(picker.pick).toHaveBeenCalledWith({
            context: 'replace',
            tileId: failedId,
        });
        expect(store.tile(failedId)?.playbackSessionKey).toBe('session:news');
    });

    it('names a spent connection budget', () => {
        fixture.componentRef.setInput('budget', {
            playlistName: 'Synthetic provider',
            maxConnections: 1,
            activeConnections: 1,
        });
        fixture.detectChanges();

        expect(host().textContent).toContain(
            'PLAYER.MULTIVIEW.ERROR_LIMIT_TITLE'
        );
    });
});
