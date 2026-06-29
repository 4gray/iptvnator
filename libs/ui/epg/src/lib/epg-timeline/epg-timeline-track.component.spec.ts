import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { EpgTimelineTrackComponent } from './epg-timeline-track.component';
import { TimelineRenderBlock } from './epg-timeline.utils';

function renderBlock(
    overrides: Partial<TimelineRenderBlock> = {}
): TimelineRenderBlock {
    const startMs = Date.now();
    return {
        kind: 'block',
        key: 'k1',
        leftPx: 0,
        widthPx: 40,
        tier: 'narrow',
        nowFillPercent: 0,
        canCatchUp: false,
        block: {
            key: 'k1',
            program: {
                start: new Date(startMs).toISOString(),
                stop: new Date(startMs + 5 * 60_000).toISOString(),
                channel: 'ch',
                title: 'Breaking News',
                desc: 'A short bulletin.',
                category: null,
            },
            startMs,
            stopMs: startMs + 5 * 60_000,
            when: 'future',
            offsetMin: 0,
            durationMin: 5,
        },
        ...overrides,
    };
}

describe('EpgTimelineTrackComponent', () => {
    let fixture: ComponentFixture<EpgTimelineTrackComponent>;
    let component: EpgTimelineTrackComponent;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [EpgTimelineTrackComponent],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
                        get: () => new BehaviorSubject(''),
                        stream: () => new BehaviorSubject(''),
                        instant: (key: string) => key,
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(EpgTimelineTrackComponent);
        component = fixture.componentInstance;
    });

    it('shows a popover for a non-wide block on enter', () => {
        const item = renderBlock({ tier: 'narrow' });
        const event = {
            currentTarget: {
                getBoundingClientRect: () => ({
                    left: 100,
                    width: 40,
                    top: 60,
                    bottom: 200,
                }),
            },
        } as unknown as Event;

        component.onBlockEnter(item, event);
        expect(component.popover()?.title).toBe('Breaking News');
        component.onBlockLeave();
        expect(component.popover()).toBeNull();
    });

    it('never shows a popover for a wide block', () => {
        const item = renderBlock({ tier: 'wide' });
        component.onBlockEnter(item, {
            currentTarget: {
                getBoundingClientRect: () => ({ left: 0, width: 200, bottom: 0 }),
            },
        } as unknown as Event);
        expect(component.popover()).toBeNull();
    });

    function wideBlock(
        desc: string | null,
        title = 'Short'
    ): TimelineRenderBlock {
        const base = renderBlock({ tier: 'wide', widthPx: 200 });
        return {
            ...base,
            block: {
                ...base.block,
                program: { ...base.block.program, title, desc },
            },
        };
    }

    it('renders a dimmed description preview inside a wide block with a description', () => {
        fixture.componentRef.setInput('items', [
            wideBlock('First sentence of the description.'),
        ]);
        fixture.detectChanges();

        const desc = fixture.nativeElement.querySelector(
            '.epg-timeline__block-desc'
        );
        expect(desc).toBeTruthy();
        expect(desc.textContent.trim()).toContain('First sentence');
    });

    it('omits the description preview for non-wide tiers', () => {
        // renderBlock() defaults to a 'med' tier with a non-empty desc.
        fixture.componentRef.setInput('items', [
            renderBlock({ tier: 'med', widthPx: 80 }),
        ]);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.epg-timeline__block-desc')
        ).toBeNull();
    });

    it('omits the description preview for a wide block without a description', () => {
        fixture.componentRef.setInput('items', [wideBlock(null)]);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.epg-timeline__block-desc')
        ).toBeNull();
    });

    it('marks the active programme as playing', () => {
        const item = renderBlock();
        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('activeProgram', item.block.program);
        expect(component.isPlaying(item)).toBe(true);
        expect(component.isSelected(item)).toBe(false);

        fixture.componentRef.setInput('selectedKey', item.block.key);
        expect(component.isSelected(item)).toBe(true);
    });
});
