import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
});
