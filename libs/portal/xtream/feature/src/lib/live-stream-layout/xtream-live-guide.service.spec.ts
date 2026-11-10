import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkspaceHeaderContextService } from '@iptvnator/portal/shared/util';
import {
    EpgPreferencesService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import { XtreamLiveGuideService } from './xtream-live-guide.service';

it('hides the header and palette contribution and closes the guide when EPG is disabled', () => {
    const enabled = signal(false);
    const playing = signal(false);
    const source = {
        playlist: signal({ id: 'synthetic-portal' }),
        open: jest.fn(),
        close: jest.fn(),
    };
    TestBed.configureTestingModule({
        providers: [
            XtreamLiveGuideService,
            { provide: XtreamEpgGuideSourceService, useValue: source },
            { provide: EpgPreferencesService, useValue: { enabled } },
            {
                provide: RuntimeCapabilitiesService,
                useValue: { supportsProviderEpg: true },
            },
            {
                provide: ElementRef,
                useValue: new ElementRef(document.createElement('div')),
            },
        ],
    });
    const guide = TestBed.inject(XtreamLiveGuideService);
    const header = TestBed.inject(WorkspaceHeaderContextService);
    guide.bind(playing);
    TestBed.flushEffects();
    expect(header.action()).toBeNull();
    enabled.set(true);
    TestBed.flushEffects();
    expect(header.action()?.disabled?.()).toBe(true);
    playing.set(true);
    header.action()?.run();
    expect(guide.isOpen()).toBe(true);
    enabled.set(false);
    TestBed.flushEffects();
    expect(header.action()).toBeNull();
    expect(guide.isOpen()).toBe(false);
    expect(source.close).toHaveBeenCalledTimes(1);
});
