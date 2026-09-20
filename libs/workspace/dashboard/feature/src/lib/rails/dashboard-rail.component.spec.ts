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

        it('renders the episode chip and remaining time, and drops an empty meta row', async () => {
            const element = await renderCards([
                card({
                    id: 'show',
                    title: 'Fake',
                    contentType: 'movie',
                    episodeBadge: 'S1·E5',
                    remainingLabel: {
                        key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
                        params: { minutes: 12 },
                    },
                }),
                card({ id: 'bare', title: 'Bare', contentType: 'movie' }),
            ]);

            const cards = element.querySelectorAll('.rail__card');
            expect(cards).toHaveLength(2);
            expect(
                cards[0].querySelector('.rail__card-episode')?.textContent
            ).toBe('S1·E5');
            expect(
                cards[0]
                    .querySelector('.rail__card-remaining')
                    ?.textContent?.trim()
            ).toBe('WORKSPACE.DASHBOARD.REMAINING_MINUTES');
            expect(cards[0].querySelector('.rail__card-subtitle')).toBeNull();
            expect(cards[1].querySelector('.rail__card-meta-row')).toBeNull();
        });
    });

    describe('visible cards', () => {
        type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;
        let observers: {
            callback: ObserverCallback;
            options: IntersectionObserverInit;
            observed: Element[];
            disconnect: jest.Mock;
        }[];

        const installObservers = (available: boolean) => {
            observers = [];
            const scope = globalThis as unknown as {
                IntersectionObserver?: unknown;
                ResizeObserver: unknown;
            };
            scope.ResizeObserver = class {
                observe = jest.fn();
                unobserve = jest.fn();
                disconnect = jest.fn();
            };
            if (!available) {
                delete scope.IntersectionObserver;
                return;
            }
            scope.IntersectionObserver = class {
                observed: Element[] = [];
                disconnect = jest.fn();
                constructor(
                    callback: ObserverCallback,
                    options: IntersectionObserverInit
                ) {
                    observers.push({
                        callback,
                        options,
                        observed: this.observed,
                        disconnect: this.disconnect,
                    });
                }
                observe(element: Element): void {
                    this.observed.push(element);
                }
                unobserve = jest.fn();
            };
        };

        const render = async (
            items: DashboardRailCard[],
            layout: 'channel' | 'cover' = 'channel'
        ) => {
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
            const visible: string[][] = [];
            fixture.componentInstance.visibleCardsChanged.subscribe((cards) =>
                visible.push(cards.map((card) => card.id))
            );
            fixture.componentRef.setInput('label', 'Live');
            fixture.componentRef.setInput('layout', layout);
            fixture.componentRef.setInput('items', items);
            fixture.detectChanges();
            await fixture.whenStable();
            return { fixture, visible };
        };

        const intersect = (
            observer: (typeof observers)[number],
            states: Record<string, boolean>
        ) => {
            observer.callback(
                observer.observed
                    .filter(
                        (element) =>
                            (element as HTMLElement).dataset['cardId']! in
                            states
                    )
                    .map(
                        (element) =>
                            ({
                                target: element,
                                isIntersecting:
                                    states[
                                        (element as HTMLElement).dataset[
                                            'cardId'
                                        ]!
                                    ],
                            }) as IntersectionObserverEntry
                    )
            );
        };

        it('reports only the cards the observer sees, in item order, inside the track viewport', async () => {
            installObservers(true);
            const { visible } = await render([
                card({ id: 'a', contentType: 'live' }),
                card({ id: 'b', contentType: 'live' }),
                card({ id: 'c', contentType: 'live' }),
            ]);
            expect(observers).toHaveLength(1);
            const [observer] = observers;
            expect(observer.observed).toHaveLength(3);
            expect(
                (observer.options.root as HTMLElement).classList.contains(
                    'rail__track'
                )
            ).toBe(true);
            expect(observer.options.rootMargin).toContain('160px');

            intersect(observer, { c: true, a: true, b: false });
            expect(visible.at(-1)).toEqual(['a', 'c']);

            // Scrolling: b enters, a leaves.
            intersect(observer, { b: true, a: false });
            expect(visible.at(-1)).toEqual(['b', 'c']);

            // Same set again does not re-emit.
            const emissions = visible.length;
            intersect(observer, { b: true });
            expect(visible).toHaveLength(emissions);
        });

        it('re-observes the rendered elements when the item set changes and forgets removed cards', async () => {
            installObservers(true);
            const { fixture, visible } = await render([
                card({ id: 'a', contentType: 'live' }),
                card({ id: 'b', contentType: 'live' }),
            ]);
            const [observer] = observers;
            intersect(observer, { a: true, b: true });
            expect(visible.at(-1)).toEqual(['a', 'b']);

            fixture.componentRef.setInput('items', [
                card({ id: 'b', contentType: 'live' }),
                card({ id: 'c', contentType: 'live' }),
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            // One observer, disconnected and re-armed on the new elements.
            expect(observers).toHaveLength(1);
            expect(observer.disconnect).toHaveBeenCalled();
            expect(
                observer.observed
                    .slice(-2)
                    .map(
                        (element) => (element as HTMLElement).dataset['cardId']
                    )
            ).toEqual(['b', 'c']);
            // `a` is gone from the visible set even before c is notified.
            expect(visible.at(-1)).toEqual(['b']);
        });

        it('reports every card when IntersectionObserver is unavailable', async () => {
            installObservers(false);
            const { visible } = await render(
                [
                    card({ id: 'a', contentType: 'movie' }),
                    card({ id: 'b', contentType: 'movie' }),
                ],
                'cover'
            );
            expect(visible.at(-1)).toEqual(['a', 'b']);
        });

        it('shows the placeholder only while a live card is pending its first answer', async () => {
            installObservers(false);
            const { fixture } = await render([
                card({
                    id: 'pending',
                    contentType: 'live',
                    subtitle: 'Xtream · TV',
                    nowPlayingState: 'pending',
                }),
                card({
                    id: 'answered',
                    contentType: 'live',
                    subtitle: 'Xtream · TV',
                    nowPlayingTitle: 'Evening news',
                    nowPlayingState: null,
                }),
                card({ id: 'none', contentType: 'live', subtitle: 'M3U · TV' }),
            ]);
            const rows = Array.from(
                (fixture.nativeElement as HTMLElement).querySelectorAll(
                    '.rail__channel-now'
                )
            );
            expect(
                rows[0].querySelector('.rail__channel-now-placeholder')
            ).not.toBeNull();
            expect(rows[0].textContent?.trim()).toBe('');
            expect(rows[1].textContent?.trim()).toBe('Evening news');
            expect(rows[2].textContent?.trim()).toBe('M3U · TV');
            expect(
                (fixture.nativeElement as HTMLElement).querySelectorAll(
                    '.rail__channel-now-placeholder'
                )
            ).toHaveLength(1);
        });
    });
});
