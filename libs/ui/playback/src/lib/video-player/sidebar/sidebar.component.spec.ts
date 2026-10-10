import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
    it('re-words the channel count after a runtime language switch', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), SidebarComponent],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist: signal(null) },
                },
            ],
        }).overrideComponent(SidebarComponent, {
            set: { template: '', imports: [] },
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            HOME: { PLAYLISTS: { CHANNELS: 'channels' } },
        });
        translate.setTranslation('ru', {
            HOME: { PLAYLISTS: { CHANNELS: 'каналов' } },
        });
        translate.use('en');
        const fixture = TestBed.createComponent(SidebarComponent);
        fixture.componentRef.setInput('channels', [{}, {}]);

        expect(fixture.componentInstance.subtitle()).toBe('2 channels');

        translate.use('ru');

        expect(fixture.componentInstance.subtitle()).toBe('2 каналов');
    });
});
