import { signal } from '@angular/core';
import { SettingsFavoritesSectionComponent } from './settings-favorites-section.component';
import type {
    FavoritesSyncRuntime,
    FavoritesImportPreview,
} from '../services/favorites-sync-runtime';
function fixture() {
    const component = new SettingsFavoritesSectionComponent();
    const preview: FavoritesImportPreview = {
        instanceId: 'nas',
        generation: 'consent',
        sources: [
            {
                sourceId: 'source',
                incarnation: 'first',
                items: [
                    {
                        reference: {
                            provider: 'xtream',
                            kind: 'movie',
                            id: '42',
                        },
                        original: '',
                        snapshot: { title: 'Synthetic item' },
                    },
                ],
            },
        ],
        unresolved: 1,
    };
    const runtime = {
        enabled: signal(false),
        setEnabled: jest.fn(async (_enabled: boolean) => undefined),
        previewImport: jest.fn(async () => preview),
        importFavorites: jest.fn(async (_preview: FavoritesImportPreview) => 1),
        parked: jest.fn(async (_send: boolean) => undefined),
        refresh: jest.fn(async () => undefined),
    };
    component.runtime.set(runtime as unknown as FavoritesSyncRuntime);
    return { component, runtime, preview };
}
describe('independent favorite settings consent', () => {
    it('keeps the checkbox truthful after a failed storage write', async () => {
        const f = fixture();
        f.runtime.setEnabled.mockRejectedValueOnce(
            new Error('Synthetic storage failure')
        );
        const event = { checked: true, source: { checked: true } };
        await f.component.toggle(event);
        expect(event.source.checked).toBe(false);
        expect(f.component.failed()).toBe(true);
    });
    it('offers local favorites for import right after enabling instead of dropping them silently', async () => {
        const f = fixture();
        f.runtime.setEnabled.mockImplementation(async (enabled: boolean) => {
            f.runtime.enabled.set(enabled);
        });
        await f.component.toggle({ checked: true, source: { checked: true } });
        expect(f.runtime.previewImport).toHaveBeenCalled();
        expect(f.component.preview()).toEqual(f.preview);
        expect(f.component.count()).toBe(1);
        expect(f.runtime.importFavorites).not.toHaveBeenCalled();
    });
    it('does not offer an import after disabling', async () => {
        const f = fixture();
        f.runtime.setEnabled.mockImplementation(async () => {
            f.runtime.enabled.set(false);
        });
        await f.component.toggle({
            checked: false,
            source: { checked: true },
        });
        expect(f.runtime.previewImport).not.toHaveBeenCalled();
        expect(f.component.preview()).toBeNull();
    });
    it('shows preview counts without importing and imports only after an explicit action', async () => {
        const f = fixture();
        await f.component.previewImport();
        expect(f.component.count()).toBe(1);
        expect(f.runtime.importFavorites).not.toHaveBeenCalled();
        await f.component.importFavorites();
        expect(f.runtime.importFavorites).toHaveBeenCalledWith(f.preview);
        expect(f.component.preview()).toBeNull();
        expect(f.component.unresolved()).toBe(1);
    });
    it('retains the preview after a failed import so it can be retried', async () => {
        const f = fixture();
        await f.component.previewImport();
        f.runtime.importFavorites.mockRejectedValueOnce(
            new Error('Synthetic server failure')
        );
        await f.component.importFavorites();
        expect(f.component.preview()).toEqual(f.preview);
        expect(f.component.failed()).toBe(true);
    });
    it('never sends an old queue before the explicit send action', async () => {
        const f = fixture();
        expect(f.runtime.parked).not.toHaveBeenCalled();
        await f.component.parked(false);
        expect(f.runtime.parked).toHaveBeenCalledWith(false);
    });
});
