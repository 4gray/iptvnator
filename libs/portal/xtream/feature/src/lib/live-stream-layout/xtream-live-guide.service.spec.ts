import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkspaceHeaderContextService } from '@iptvnator/portal/shared/util';
import {
    EpgPreferencesService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { EpgProgrammeDialogService } from '@iptvnator/ui/epg';
import { Subject } from 'rxjs';
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
            {
                provide: EpgProgrammeDialogService,
                useValue: { ownedAfterClosed: () => undefined },
            },
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
    const originalAction = header.action();
    source.playlist.set({ id: 'synthetic-portal' });
    TestBed.flushEffects();
    expect(header.action()).toBe(originalAction);
    expect(guide.isOpen()).toBe(true);
    enabled.set(false);
    TestBed.flushEffects();
    expect(header.action()).toBeNull();
    expect(guide.isOpen()).toBe(false);
    expect(source.close).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
    'waits for the programme overlay before restoring focus only if it owns it (%s)',
    async (owned) => {
        const surface = document.createElement('main');
        surface.className = 'workspace-content';
        const trigger = document.createElement('button');
        const overlay = document.createElement('button');
        const dialogClosed = new Subject<void>();
        const playing = signal(true);
        surface.append(trigger);
        document.body.append(surface, overlay);
        TestBed.configureTestingModule({
            providers: [
                XtreamLiveGuideService,
                {
                    provide: XtreamEpgGuideSourceService,
                    useValue: {
                        playlist: signal({ id: 'synthetic-portal' }),
                        open: jest.fn(),
                        close: jest.fn(),
                    },
                },
                {
                    provide: EpgPreferencesService,
                    useValue: { enabled: signal(true) },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsProviderEpg: true },
                },
                { provide: ElementRef, useValue: new ElementRef(surface) },
                {
                    provide: EpgProgrammeDialogService,
                    useValue: {
                        ownedAfterClosed: (element: Element) =>
                            owned && element === overlay
                                ? dialogClosed
                                : undefined,
                    },
                },
            ],
        });
        try {
            const guide = TestBed.inject(XtreamLiveGuideService);
            guide.bind(playing);
            trigger.focus();
            guide.open();
            overlay.focus();
            playing.set(false);
            TestBed.flushEffects();
            expect(guide.isOpen()).toBe(false);
            expect(document.activeElement).toBe(overlay);
            overlay.remove();
            dialogClosed.next();
            await Promise.resolve();
            expect(document.activeElement).toBe(
                owned ? trigger : document.body
            );
        } finally {
            dialogClosed.complete();
            surface.remove();
            overlay.remove();
        }
    }
);
