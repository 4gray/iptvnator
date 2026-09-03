import {
    Component,
    TemplateRef,
    computed,
    forwardRef,
    signal,
    viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    CHANNEL_PANEL_CLOSE_GRACE_MS,
    CHANNEL_PANEL_OPEN_DWELL_MS,
} from './fullscreen-channel-panel-state';
import { FullscreenChannelPanelComponent } from './fullscreen-channel-panel.component';
import {
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
    type FullscreenChannelPanelHost,
} from './fullscreen-channel-panel.model';

@Component({
    imports: [FullscreenChannelPanelComponent],
    template: `
        <div #stage class="stage">
            <app-fullscreen-channel-panel [stage]="stage" />
        </div>
        <ng-template #panel let-searchTerm="searchTerm" let-close="close">
            <div data-test-id="host-list">{{ searchTerm() }}</div>
            <button type="button" data-test-id="host-close" (click)="close()">
                close
            </button>
        </ng-template>
    `,
    providers: [
        {
            provide: FULLSCREEN_CHANNEL_PANEL,
            useExisting: forwardRef(() => HostComponent),
        },
    ],
})
class HostComponent implements FullscreenChannelPanelHost {
    private readonly panelRef =
        viewChild<TemplateRef<FullscreenChannelPanelContext>>('panel');
    readonly enabled = signal(true);
    readonly panelTemplate = computed(() =>
        this.enabled() ? (this.panelRef() ?? null) : null
    );
    readonly panelTitle = signal('Playlist One');
}

@Component({
    imports: [FullscreenChannelPanelComponent],
    template: `
        <div #stage class="stage">
            <app-fullscreen-channel-panel [stage]="stage" />
        </div>
    `,
})
class NoHostComponent {}

function pointerEvent(type: string, pointerType = 'mouse'): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
}

describe('FullscreenChannelPanelComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let stage: HTMLElement;
    let fullscreenElement: Element | null;

    const query = <T extends HTMLElement>(testId: string): T | null =>
        fixture.nativeElement.querySelector(`[data-test-id="${testId}"]`);
    const panel = () => query('fullscreen-channel-panel');
    const hotZone = () => query('fullscreen-channel-panel-hot-zone');
    const isOpen = () =>
        panel()?.classList.contains('fullscreen-channel-panel--open') === true;

    const setFullscreen = (element: Element | null) => {
        fullscreenElement = element;
        document.dispatchEvent(new Event('fullscreenchange'));
        fixture.detectChanges();
    };

    const openByHover = () => {
        hotZone()?.dispatchEvent(pointerEvent('pointerenter'));
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        fixture.detectChanges();
    };

    beforeEach(async () => {
        jest.useFakeTimers();
        await TestBed.configureTestingModule({
            imports: [
                HostComponent,
                NoHostComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fullscreenElement = null;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });

        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
        stage = fixture.nativeElement.querySelector('.stage');
    });

    afterEach(() => {
        fixture.destroy();
        jest.useRealTimers();
    });

    it('renders nothing outside fullscreen', () => {
        expect(hotZone()).toBeNull();
        expect(panel()).toBeNull();
    });

    it('renders nothing without a host list, even in fullscreen', () => {
        fixture.destroy();
        const noHost = TestBed.createComponent(NoHostComponent);
        noHost.detectChanges();
        fullscreenElement = noHost.nativeElement.querySelector('.stage');
        document.dispatchEvent(new Event('fullscreenchange'));
        noHost.detectChanges();

        expect(
            noHost.nativeElement.querySelector(
                '[data-test-id="fullscreen-channel-panel-hot-zone"]'
            )
        ).toBeNull();
        expect(
            noHost.nativeElement.querySelector(
                '[data-test-id="fullscreen-channel-panel"]'
            )
        ).toBeNull();
        noHost.destroy();
    });

    it('renders nothing when the host disables the panel', () => {
        host.enabled.set(false);
        setFullscreen(stage);

        expect(hotZone()).toBeNull();
        expect(panel()).toBeNull();
    });

    it('draws nothing over the video while closed: only the hot zone beside the inert, off-screen panel', () => {
        setFullscreen(stage);

        const children = Array.from(
            (
                fixture.nativeElement.querySelector(
                    '.fullscreen-channel-panel-host'
                ) as HTMLElement
            ).children
        );
        expect(children.map((child) => child.tagName.toLowerCase())).toEqual([
            'div',
            'aside',
        ]);
        expect(children[0]).toBe(hotZone());
        expect(hotZone()?.textContent?.trim()).toBe('');
        expect(isOpen()).toBe(false);
        expect(panel()?.getAttribute('aria-hidden')).toBe('true');
        expect(panel()?.hasAttribute('inert')).toBe(true);
        expect(query('host-list')).toBeNull();
    });

    it('slides in after the mouse rests on the left edge and stamps the host list', () => {
        setFullscreen(stage);
        openByHover();

        expect(isOpen()).toBe(true);
        expect(query('host-list')).not.toBeNull();
        expect(query('fullscreen-channel-panel-scrim')).not.toBeNull();
        expect(hotZone()).toBeNull();
    });

    it('does not open for a mouse that merely sweeps across the edge', () => {
        setFullscreen(stage);
        hotZone()?.dispatchEvent(pointerEvent('pointerenter'));
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS - 1);
        hotZone()?.dispatchEvent(pointerEvent('pointerleave'));
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        fixture.detectChanges();

        expect(isOpen()).toBe(false);
    });

    it('opens on a touch tap on the edge without any dwell', () => {
        setFullscreen(stage);
        hotZone()?.dispatchEvent(pointerEvent('pointerenter', 'touch'));
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        fixture.detectChanges();
        expect(isOpen()).toBe(false);

        hotZone()?.dispatchEvent(pointerEvent('pointerup', 'touch'));
        fixture.detectChanges();
        expect(isOpen()).toBe(true);
    });

    it('puts the host title into the search placeholder and the dialog label instead of a title row', () => {
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                EMBEDDED_MPV: {
                    PLAYER: {
                        SEARCH_IN: 'Search in {{title}}',
                        SEARCH_CHANNELS: 'Search channels',
                    },
                },
            },
            true
        );
        translate.use('en');
        setFullscreen(stage);
        openByHover();

        const input = query<HTMLInputElement>(
            'fullscreen-channel-panel-search'
        );
        expect(input?.placeholder).toBe('Search in Playlist One');
        expect(panel()?.getAttribute('aria-label')).toBe('Playlist One');
        expect(panel()?.querySelector('h1, h2, h3')).toBeNull();

        host.panelTitle.set('');
        fixture.detectChanges();
        expect(input?.placeholder).toBe('Search channels');
    });

    it('feeds the search field into the host template context', () => {
        setFullscreen(stage);
        openByHover();

        const input = query<HTMLInputElement>(
            'fullscreen-channel-panel-search'
        );
        input!.value = 'news';
        input!.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        expect(query('host-list')?.textContent?.trim()).toBe('news');

        query('fullscreen-channel-panel-search-clear')?.click();
        fixture.detectChanges();
        expect(query('host-list')?.textContent?.trim()).toBe('');
    });

    it('closes on the scrim but keeps the list mounted for the next opening', () => {
        setFullscreen(stage);
        openByHover();
        query('fullscreen-channel-panel-scrim')?.click();
        fixture.detectChanges();

        expect(isOpen()).toBe(false);
        expect(query('host-list')).not.toBeNull();
        expect(hotZone()).not.toBeNull();

        openByHover();
        expect(isOpen()).toBe(true);
    });

    it('closes from the close button', () => {
        setFullscreen(stage);
        openByHover();
        query('fullscreen-channel-panel-close')?.click();
        fixture.detectChanges();

        expect(isOpen()).toBe(false);
    });

    it('closes after the mouse leaves the panel unless it comes back', () => {
        setFullscreen(stage);
        openByHover();

        panel()?.dispatchEvent(pointerEvent('pointerleave'));
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS - 1);
        panel()?.dispatchEvent(pointerEvent('pointerenter'));
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);
        fixture.detectChanges();
        expect(isOpen()).toBe(true);

        panel()?.dispatchEvent(pointerEvent('pointerleave'));
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);
        fixture.detectChanges();
        expect(isOpen()).toBe(false);
    });

    it('lets the host close the panel through the template context', () => {
        setFullscreen(stage);
        openByHover();
        query('host-close')?.click();
        fixture.detectChanges();

        expect(isOpen()).toBe(false);
    });

    it('toggles with the C key and focuses the search field', () => {
        setFullscreen(stage);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
        fixture.detectChanges();
        expect(isOpen()).toBe(true);

        jest.advanceTimersByTime(0);
        expect(document.activeElement).toBe(
            query('fullscreen-channel-panel-search')
        );

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'C' }));
        fixture.detectChanges();
        expect(isOpen()).toBe(false);
    });

    it('leaves the C key alone while typing and outside fullscreen', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
        fixture.detectChanges();
        expect(panel()).toBeNull();

        setFullscreen(stage);
        openByHover();
        const input = query<HTMLInputElement>(
            'fullscreen-channel-panel-search'
        );
        input?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'c', bubbles: true })
        );
        fixture.detectChanges();
        expect(isOpen()).toBe(true);

        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })
        );
        fixture.detectChanges();
        expect(isOpen()).toBe(true);
    });

    it('closes on Escape', () => {
        setFullscreen(stage);
        openByHover();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();

        expect(isOpen()).toBe(false);
    });

    it('drops the panel, its list and the search when fullscreen ends', () => {
        setFullscreen(stage);
        openByHover();
        const input = query<HTMLInputElement>(
            'fullscreen-channel-panel-search'
        );
        input!.value = 'sport';
        input!.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        setFullscreen(null);

        expect(panel()).toBeNull();
        expect(hotZone()).toBeNull();

        setFullscreen(stage);
        expect(isOpen()).toBe(false);
        expect(query('host-list')).toBeNull();
        openByHover();
        expect(query('host-list')?.textContent?.trim()).toBe('');
    });
});
