import { signal } from '@angular/core';
import {
    ComponentFixture,
    DeferBlockBehavior,
    DeferBlockState,
    TestBed,
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    EpgImportProgress,
    EpgProgressService,
} from '@iptvnator/epg/data-access';
import { EpgProgressPanelComponent } from './epg-progress-panel.component';

describe('EpgProgressPanelComponent', () => {
    const imports = signal<EpgImportProgress[]>([]);
    const isVisible = signal(false);
    const activeCount = signal(0);
    const queuedCount = signal(0);
    let fixture: ComponentFixture<EpgProgressPanelComponent>;

    function setImports(items: EpgImportProgress[]): void {
        imports.set(items);
        isVisible.set(items.length > 0);
        activeCount.set(items.filter((i) => i.status !== 'queued').length);
        queuedCount.set(items.filter((i) => i.status === 'queued').length);
    }

    /** Lets the deferred view's chunk resolve, then renders it. */
    async function settle(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
    }

    async function configure(
        deferBlockBehavior = DeferBlockBehavior.Playthrough
    ): Promise<void> {
        await TestBed.configureTestingModule({
            imports: [EpgProgressPanelComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: EpgProgressService,
                    useValue: {
                        imports,
                        isVisible,
                        activeCount,
                        queuedCount,
                        dismiss: jest.fn(),
                        dismissAll: jest.fn(),
                        retry: jest.fn(),
                    },
                },
            ],
            deferBlockBehavior,
        }).compileComponents();
        fixture = TestBed.createComponent(EpgProgressPanelComponent);
        await settle();
    }

    beforeEach(async () => {
        setImports([]);
        await configure();
    });

    afterEach(() => fixture.destroy());

    it('renders no view while no import is running', () => {
        expect(
            fixture.nativeElement.querySelector('app-epg-progress-panel-view')
        ).toBeNull();
    });

    it('shows the panel with the first import and hides it again when the list empties', async () => {
        setImports([{ url: 'https://example.com/epg.xml', status: 'loading' }]);
        await settle();

        expect(
            fixture.nativeElement.querySelector(
                '.epg-progress-panel .import-item.status-loading'
            )
        ).not.toBeNull();

        setImports([]);
        await settle();

        expect(
            fixture.nativeElement.querySelector('.epg-progress-panel')
        ).toBeNull();
    });

    it('tells the user when the view chunk cannot be loaded during an import', async () => {
        fixture.destroy();
        TestBed.resetTestingModule();
        await configure(DeferBlockBehavior.Manual);
        setImports([{ url: 'https://example.com/epg.xml', status: 'loading' }]);
        fixture.detectChanges();

        const [block] = await fixture.getDeferBlocks();
        await block.render(DeferBlockState.Error);

        const notice = fixture.nativeElement.querySelector('[role="alert"]');
        expect(notice?.textContent).toContain('EPG.IMPORT_PANEL_UNAVAILABLE');
        expect(
            fixture.nativeElement.querySelector('app-epg-progress-panel-view')
        ).toBeNull();
    });
});
