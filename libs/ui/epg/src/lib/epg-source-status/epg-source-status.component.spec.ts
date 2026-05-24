import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
    EpgProgressService,
    EpgRuntimeBridgeService,
} from '@iptvnator/epg/data-access';
import { EpgSourceStatusComponent } from './epg-source-status.component';

describe('EpgSourceStatusComponent', () => {
    let fixture: ComponentFixture<EpgSourceStatusComponent>;
    let component: EpgSourceStatusComponent;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    const imports = signal([]);

    beforeEach(async () => {
        epgBridge = {
            checkFreshness: jest.fn().mockResolvedValue({
                freshUrls: ['https://example.com/epg.xml'],
                staleUrls: [],
            }),
            supportsSourceFreshness: false,
        };
        imports.set([]);

        await TestBed.configureTestingModule({
            imports: [EpgSourceStatusComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: EpgProgressService,
                    useValue: { imports },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
            ],
        }).compileComponents();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    function createComponent(url = 'https://example.com/epg.xml'): void {
        fixture = TestBed.createComponent(EpgSourceStatusComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('url', url);
    }

    it('does not check source freshness when the EPG bridge cannot check freshness', async () => {
        createComponent();

        fixture.detectChanges();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).not.toHaveBeenCalled();
        expect(component.status()).toBe('unknown');
    });

    it('loads source freshness through the EPG runtime bridge', async () => {
        const url = 'https://example.com/epg.xml';
        epgBridge.supportsSourceFreshness = true;
        createComponent(url);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).toHaveBeenCalledWith([url], 12);
        expect(component.status()).toBe('fresh');
    });
});
