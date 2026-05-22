import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { EpgProgressService } from '@iptvnator/epg/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EpgSourceStatusComponent } from './epg-source-status.component';

describe('EpgSourceStatusComponent', () => {
    let fixture: ComponentFixture<EpgSourceStatusComponent>;
    let component: EpgSourceStatusComponent;
    let runtimeCapabilities: { supportsEpg: boolean };
    const imports = signal([]);
    const originalElectron = window.electron;

    beforeEach(async () => {
        runtimeCapabilities = { supportsEpg: false };
        imports.set([]);

        await TestBed.configureTestingModule({
            imports: [EpgSourceStatusComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: EpgProgressService,
                    useValue: { imports },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        }).compileComponents();
    });

    afterEach(() => {
        window.electron = originalElectron;
        fixture?.destroy();
    });

    function createComponent(url = 'https://example.com/epg.xml'): void {
        fixture = TestBed.createComponent(EpgSourceStatusComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('url', url);
    }

    it('does not check source freshness when runtime EPG support is disabled', async () => {
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: ['https://example.com/epg.xml'],
            staleUrls: [],
        });
        window.electron = {
            ...window.electron,
            checkEpgFreshness,
        } as unknown as typeof window.electron;
        createComponent();

        fixture.detectChanges();
        await fixture.whenStable();

        expect(checkEpgFreshness).not.toHaveBeenCalled();
        expect(component.status()).toBe('unknown');
    });

    it('loads source freshness when runtime EPG support is enabled', async () => {
        const url = 'https://example.com/epg.xml';
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: [url],
            staleUrls: [],
        });
        window.electron = {
            ...window.electron,
            checkEpgFreshness,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;
        createComponent(url);

        fixture.detectChanges();
        await fixture.whenStable();

        expect(checkEpgFreshness).toHaveBeenCalledWith([url], 12);
        expect(component.status()).toBe('fresh');
    });
});
