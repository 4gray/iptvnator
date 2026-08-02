import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import {
    DashboardRailCard,
    DashboardRailComponent,
} from './dashboard-rail.component';

describe('DashboardRailComponent', () => {
    const createComponent = async (stripCountryPrefix: boolean) => {
        await TestBed.configureTestingModule({
            imports: [DashboardRailComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        stripCountryPrefix: signal(stripCountryPrefix),
                    },
                },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(DashboardRailComponent);
        fixture.componentRef.setInput('label', 'Rail');
        fixture.componentRef.setInput('items', []);
        return fixture.componentInstance as unknown as {
            cardTitle(card: DashboardRailCard): string;
        };
    };

    const card = (overrides: Partial<DashboardRailCard>): DashboardRailCard =>
        ({
            id: 'card-1',
            title: 'US | CNN',
            icon: 'live_tv',
            link: ['/workspace'],
            ...overrides,
        }) as DashboardRailCard;

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    it('strips the prefix from live card titles when the setting is enabled', async () => {
        const component = await createComponent(true);

        expect(component.cardTitle(card({ contentType: 'live' }))).toBe('CNN');
    });

    it('keeps movie and series card titles untouched', async () => {
        const component = await createComponent(true);

        expect(
            component.cardTitle(
                card({ title: 'US | Some Movie', contentType: 'movie' })
            )
        ).toBe('US | Some Movie');
        expect(
            component.cardTitle(
                card({ title: 'US | Some Show', contentType: 'series' })
            )
        ).toBe('US | Some Show');
    });

    it('keeps live card titles untouched while the setting is disabled', async () => {
        const component = await createComponent(false);

        expect(component.cardTitle(card({ contentType: 'live' }))).toBe(
            'US | CNN'
        );
    });

    describe('expiry badge rendering', () => {
        beforeEach(() => {
            // jsdom has no ResizeObserver; the component observes its track
            // element after view init.
            (
                globalThis as unknown as { ResizeObserver: unknown }
            ).ResizeObserver = class {
                observe = jest.fn();
                unobserve = jest.fn();
                disconnect = jest.fn();
            };
        });

        const renderCards = async (items: DashboardRailCard[]) => {
            await TestBed.configureTestingModule({
                imports: [DashboardRailComponent, TranslateModule.forRoot()],
                providers: [
                    provideRouter([]),
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(false) },
                    },
                ],
            }).compileComponents();

            const fixture = TestBed.createComponent(DashboardRailComponent);
            fixture.componentRef.setInput('label', 'Sources');
            fixture.componentRef.setInput('items', items);
            fixture.detectChanges();
            return fixture.nativeElement as HTMLElement;
        };

        it('renders the chip only for cards with a badge and tones expired ones', async () => {
            const element = await renderCards([
                card({
                    id: 'expiring',
                    subtitle: 'Xtream',
                    expiryBadge: {
                        kind: 'expiring',
                        label: 'Expires in 3 d',
                    },
                }),
                card({
                    id: 'expired',
                    subtitle: 'Stalker',
                    expiryBadge: { kind: 'expired', label: 'Expired' },
                }),
                card({ id: 'plain', subtitle: 'M3U' }),
            ]);

            const chips = element.querySelectorAll('.rail__card-expiry');
            expect(chips).toHaveLength(2);
            expect(chips[0].textContent?.trim()).toBe('Expires in 3 d');
            expect(
                chips[0].classList.contains('rail__card-expiry--expired')
            ).toBe(false);
            expect(chips[1].textContent?.trim()).toBe('Expired');
            expect(
                chips[1].classList.contains('rail__card-expiry--expired')
            ).toBe(true);
        });
    });
});
