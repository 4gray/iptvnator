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

        it('scrolls back and re-observes only when the card set changes, not on every rebuild', async () => {
            installObservers(true);
            const { fixture } = await render([
                card({ id: 'a', contentType: 'live', nowPlayingProgress: 10 }),
                card({ id: 'b', contentType: 'live', nowPlayingProgress: 20 }),
            ]);
            const reset = jest.spyOn(
                fixture.componentInstance as unknown as {
                    scheduleResetToStart: () => void;
                },
                'scheduleResetToStart'
            );
            const observedAfterFirstRender = observers[0].observed.length;
            const rerender = async (items: DashboardRailCard[]) => {
                fixture.componentRef.setInput('items', items);
                fixture.detectChanges();
                await fixture.whenStable();
            };

            // A clock tick rebuilds every card object with new progress.
            await rerender([
                card({ id: 'a', contentType: 'live', nowPlayingProgress: 11 }),
                card({ id: 'b', contentType: 'live', nowPlayingProgress: 21 }),
            ]);
            expect(reset).not.toHaveBeenCalled();
            expect(observers[0].observed).toHaveLength(
                observedAfterFirstRender
            );

            // A newly watched channel moves to the front.
            await rerender([
                card({ id: 'b', contentType: 'live' }),
                card({ id: 'a', contentType: 'live' }),
            ]);
            expect(reset).toHaveBeenCalledTimes(1);
            expect(observers[0].observed.length).toBeGreaterThan(
                observedAfterFirstRender
            );
        });

        it('positions the live progress fill through a custom property, never its width', async () => {
            // Animating width re-lays out the page for every frame of the
            // transition on each EPG tick; the stylesheet slides the fill with
            // a compositor transform driven by this property instead.
            installObservers(false);
            const { fixture } = await render([
                card({
                    id: 'known',
                    contentType: 'live',
                    nowPlayingProgress: 37.5,
                }),
                card({ id: 'unknown', contentType: 'live' }),
            ]);
            const fills = Array.from(
                (
                    fixture.nativeElement as HTMLElement
                ).querySelectorAll<HTMLElement>('.rail__channel-progress i')
            );
            expect(fills).toHaveLength(2);
            expect(fills[0].style.getPropertyValue('--live-progress')).toBe(
                '37.5'
            );
            expect(fills[1].style.getPropertyValue('--live-progress')).toBe(
                '0'
            );
            expect(fills.map((fill) => fill.style.width)).toEqual(['', '']);
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

    describe('focus reveal', () => {
        beforeEach(() => {
            (
                globalThis as unknown as { ResizeObserver: unknown }
            ).ResizeObserver = class {
                observe = jest.fn();
                unobserve = jest.fn();
                disconnect = jest.fn();
            };
        });

        const rect = (left: number, width: number) =>
            ({ left, right: left + width, top: 0, bottom: 100 }) as DOMRect;

        /**
         * Lays the cards out at `stride` px intervals in a 1000px viewport
         * (jsdom has no layout) and records the track's `scrollTo` calls.
         */
        const renderRail = async (options: {
            count: number;
            width: number;
            stride: number;
            scrollLeft?: number;
        }) => {
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
            fixture.componentRef.setInput(
                'items',
                Array.from({ length: options.count }, (_, index) =>
                    card({
                        id: `card-${index}`,
                        actions: [
                            { id: 'edit', labelKey: 'EDIT', icon: 'edit' },
                        ],
                    })
                )
            );
            fixture.detectChanges();
            await fixture.whenStable();

            const element = fixture.nativeElement as HTMLElement;
            const scrollLeft = options.scrollLeft ?? 0;
            const track = element.querySelector('.rail__track') as HTMLElement;
            const contentWidth =
                (options.count - 1) * options.stride + options.width;
            Object.defineProperties(track, {
                scrollLeft: { configurable: true, value: scrollLeft },
                clientWidth: { configurable: true, value: 1000 },
                scrollWidth: { configurable: true, value: contentWidth },
            });
            const scrollTo = jest.fn();
            track.scrollTo = scrollTo;
            jest.spyOn(
                element.querySelector('.rail__viewport') as HTMLElement,
                'getBoundingClientRect'
            ).mockReturnValue(rect(0, 1000));
            element
                .querySelectorAll<HTMLElement>('.rail__card')
                .forEach((cardElement, index) =>
                    jest
                        .spyOn(cardElement, 'getBoundingClientRect')
                        .mockReturnValue(
                            rect(
                                index * options.stride - scrollLeft,
                                options.width
                            )
                        )
                );
            const focusLink = (index: number) =>
                element
                    .querySelectorAll<HTMLElement>('.rail__card-link')
                    [index].focus();
            return { element, scrollTo, focusLink };
        };

        it('scrolls to the end when the last card is cut off by an overflow smaller than a card', async () => {
            // Max scroll 102px: the last card shows 70px, which Chromium
            // already treats as visible enough to skip its focus scroll.
            const { scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            focusLink(5);

            expect(scrollTo).toHaveBeenCalledWith({
                left: 102,
                behavior: 'auto',
            });
        });

        it('moves to the next snap position that reveals the card rather than the nearest one', async () => {
            // A "nearest" scroll would need 264px, which mandatory snapping
            // rounds back to 0 — leaving the card cut off.
            const { scrollTo, focusLink } = await renderRail({
                count: 5,
                width: 306,
                stride: 316,
            });

            focusLink(3);

            expect(scrollTo).toHaveBeenCalledWith({
                left: 316,
                behavior: 'auto',
            });
        });

        it('keeps a card wider than the visible area at its own start instead of skipping past it', async () => {
            // The 1000px viewport cannot hold a 1200px card, so the next
            // card's snap point (2420) would move the focused one offscreen.
            const { scrollTo, focusLink } = await renderRail({
                count: 3,
                width: 1200,
                stride: 1210,
                scrollLeft: 1210,
            });

            focusLink(1);

            expect(scrollTo).toHaveBeenCalledWith({
                left: 1210,
                behavior: 'auto',
            });
        });

        it('aligns a card cut off on the left with the start edge', async () => {
            const { scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
                scrollLeft: 100,
            });

            focusLink(0);

            expect(scrollTo).toHaveBeenCalledWith({
                left: 0,
                behavior: 'auto',
            });
        });

        it('reveals the card when its actions button gains focus', async () => {
            const { element, scrollTo } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            element
                .querySelectorAll<HTMLElement>('.rail__action-trigger')[5]
                .focus();

            expect(scrollTo).toHaveBeenCalledWith({
                left: 102,
                behavior: 'auto',
            });
        });

        /**
         * Presses a card link: a pointerdown (jsdom has no PointerEvent),
         * followed for a mouse by its mousedown. A tap's compatibility
         * mousedown only comes once the finger lifts.
         */
        const pressCard = (
            element: HTMLElement,
            index: number,
            pointerType: 'mouse' | 'touch'
        ) => {
            const link = element.querySelectorAll('.rail__card-link')[index];
            const press = new MouseEvent('pointerdown', { bubbles: true });
            Object.defineProperty(press, 'pointerType', { value: pointerType });
            link.dispatchEvent(press);
            if (pointerType === 'mouse') {
                link.dispatchEvent(
                    new MouseEvent('mousedown', {
                        bubbles: true,
                        buttons: 1,
                        detail: 1,
                    })
                );
            }
        };
        // Waits out a press's focus window. The rail's first-render reset to
        // the start lands meanwhile, so its scrollTo call is forgotten.
        const wait = async (ms: number, scrollTo: jest.Mock) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            scrollTo.mockClear();
        };

        it('keeps the rail still when a mouse press focuses a partly hidden card', async () => {
            // Scrolling on mousedown would move the card from under the
            // pointer, so the click would land elsewhere.
            const { element, scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            pressCard(element, 5, 'mouse');
            focusLink(5);

            expect(scrollTo).not.toHaveBeenCalled();
        });

        it('keeps the rail still when a tap focuses the card after the finger lifts', async () => {
            const { element, scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            pressCard(element, 5, 'touch');
            await wait(150, scrollTo);
            focusLink(5);

            expect(scrollTo).not.toHaveBeenCalled();
        });

        it('still reveals a card focused from script after an earlier mouse press', async () => {
            const { element, scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            pressCard(element, 0, 'mouse');
            await wait(150, scrollTo);
            focusLink(5);

            expect(scrollTo).toHaveBeenCalledWith({
                left: 102,
                behavior: 'auto',
            });
        });

        it('leaves the scroll position alone for a fully visible card', async () => {
            const { scrollTo, focusLink } = await renderRail({
                count: 6,
                width: 172,
                stride: 186,
            });

            focusLink(4);

            expect(scrollTo).not.toHaveBeenCalled();
        });
    });
});
