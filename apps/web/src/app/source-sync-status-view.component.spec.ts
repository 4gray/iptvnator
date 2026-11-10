import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { SourceSyncStatusViewComponent } from './source-sync-status-view.component';

describe(SourceSyncStatusViewComponent.name, () => {
    const setup = async (hasCachedLibrary: boolean) => {
        const sync = {
            connection: { apiUrl: 'https://nas.test/api', instanceId: 'nas' },
            hasCachedLibrary,
            state: signal('offline'),
            stateKey: signal('SOURCE_SYNC.STATE_offline'),
            errorKey: signal('SOURCE_SYNC.OFFLINE'),
            refresh: jest.fn(),
        };
        await TestBed.configureTestingModule({
            imports: [SourceSyncStatusViewComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                { provide: SourceSyncService, useValue: sync },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(SourceSyncStatusViewComponent);
        const root = fixture.nativeElement as HTMLElement;
        fixture.detectChanges();
        return { fixture, root, sync };
    };

    it('keeps a dismissed outage hidden across retries but shows a new recovery problem', async () => {
        const { fixture, root, sync } = await setup(true);
        root.querySelector<HTMLButtonElement>('button[aria-label]')?.click();
        fixture.detectChanges();
        expect(sync.refresh).not.toHaveBeenCalled();
        expect(root.querySelector('section')).toBeNull();

        sync.state.set('connected');
        fixture.detectChanges();
        sync.state.set('offline');
        fixture.detectChanges();
        expect(root.querySelector('section')).toBeNull();

        sync.errorKey.set('SOURCE_SYNC.INSTANCE_CHANGED');
        fixture.detectChanges();
        expect(root.textContent).toContain('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(root.querySelector('button[aria-label]')).toBeNull();

        sync.errorKey.set('SOURCE_SYNC.LOCKED');
        sync.state.set('locked');
        fixture.detectChanges();
        expect(root.querySelector('input[type="password"]')).not.toBeNull();
    });

    it('disables retry while the first inventory is connecting', async () => {
        const { fixture, root, sync } = await setup(false);
        sync.state.set('connecting');
        fixture.detectChanges();

        const retry = root.querySelector<HTMLButtonElement>('button');
        expect(retry?.disabled).toBe(true);
        expect(root.querySelector('a')).not.toBeNull();
    });

    it('keeps recovery available when the first inventory has not loaded', async () => {
        const { root } = await setup(false);
        expect(root.querySelector('a')).not.toBeNull();
        expect(root.querySelector('button[aria-label]')).toBeNull();
    });
});
