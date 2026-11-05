import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import type { FavoriteEntry } from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesSyncRuntime } from '../services/favorites-sync-runtime';
import { SettingsFavoritesSectionComponent } from './settings-favorites-section.component';

describe('identifiable per-item favorite conflicts', () => {
    it('shows titles or identity fallbacks, source names and both values before resolving the selected item', async () => {
        localStorage.clear();
        await prepareSourceConnection();
        TestBed.configureTestingModule({
            imports: [
                SettingsFavoritesSectionComponent,
                TranslateModule.forRoot(),
                NoopAnimationsModule,
            ],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            FAVORITES_SYNC: {
                LOCAL_MEMBERSHIP: 'Local',
                SERVER_MEMBERSHIP: 'Server',
                MEMBER_PRESENT: 'Favorite',
                MEMBER_ABSENT: 'Not a favorite',
            },
        });
        translate.use('en');
        const entries: FavoriteEntry[] = [42, 43].map((id, index) => ({
            address: {
                instanceId: 'nas',
                scope: 'shared',
                sourceId: `synthetic-source-${index}`,
                sourceIncarnation: 'first',
                content: { provider: 'xtream', kind: 'movie', id: String(id) },
            },
            record: {
                state: {
                    revision: 1,
                    member: index === 0,
                    ...(index === 0
                        ? { snapshot: { title: 'Synthetic conflict item' } }
                        : {}),
                },
                base: { revision: 0, member: false },
                conflict: { revision: 2, member: index !== 0 },
                pending: [],
            },
        }));
        const resolve = jest.fn(async () => undefined);
        const runtime = {
            enabled: signal(true),
            busy: signal(false),
            error: signal(false),
            state: () => 'conflict',
            stateKey: () => 'conflict',
            lastSync: () => null,
            pending: () => 0,
            parkedCount: () => 0,
            conflicts: () => entries,
            sourceTitle: (id: string) =>
                id.endsWith('0')
                    ? 'Synthetic source Alpha'
                    : 'Synthetic source Beta',
            resolve,
        };
        const fixture = TestBed.createComponent(
            SettingsFavoritesSectionComponent
        );
        fixture.componentInstance.runtime.set(
            runtime as unknown as FavoritesSyncRuntime
        );
        fixture.detectChanges();
        const cards = fixture.nativeElement.querySelectorAll(
            '.favorites-conflict'
        ) as NodeListOf<HTMLElement>;
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('Synthetic conflict item');
        expect(cards[0].textContent).toContain('Synthetic source Alpha');
        expect(cards[0].textContent).toContain('Local: Favorite');
        expect(cards[0].textContent).toContain('Server: Not a favorite');
        expect(cards[1].textContent).toContain('xtream · movie · 43');
        expect(cards[1].textContent).toContain('Synthetic source Beta');
        (
            cards[1].querySelector(
                '[data-test-id="favorites-use-local"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();
        expect(resolve).toHaveBeenCalledWith(entries[1].address, true);
        fixture.destroy();
    });
});
