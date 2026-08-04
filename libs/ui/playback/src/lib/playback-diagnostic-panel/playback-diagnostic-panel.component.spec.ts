import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    PlaybackRecommendationReason,
    type PlaybackDiagnostic,
    type PlaybackRecommendation,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import type {
    ResolvedPortalPlayback,
    VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import { PlaybackDiagnosticPanelComponent } from './playback-diagnostic-panel.component';

const DIAGNOSTIC: PlaybackDiagnostic = {
    code: PlaybackDiagnosticCode.UnsupportedContainer,
    source: PlaybackDiagnosticSource.Source,
    sourceUrl: 'https://example.com/archive/movie.mkv',
    container: 'matroska',
    mimeType: 'video/matroska',
    player: 'videojs',
    audioCodecs: [],
    videoCodecs: [],
};

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/archive/movie.mkv',
    title: 'Example Movie',
};

const PANEL_STYLE_SOURCE = readFileSync(
    resolve(
        process.cwd(),
        'libs/ui/playback/src/lib/playback-diagnostic-panel/playback-diagnostic-panel.component.scss'
    ),
    'utf8'
);

function contrastRatio(foreground: string, background: string): number {
    const luminance = (hex: string): number => {
        const channels = [1, 3, 5].map((offset) =>
            Number.parseInt(hex.slice(offset, offset + 2), 16)
        );
        const [red, green, blue] = channels.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const values = [luminance(foreground), luminance(background)].sort(
        (left, right) => right - left
    );

    return (values[0] + 0.05) / (values[1] + 0.05);
}

function recommendation(
    action: PlaybackRecommendation['action'],
    overrides: Partial<PlaybackRecommendation> = {}
): PlaybackRecommendation {
    if (action === 'retry') {
        return {
            action,
            reason: PlaybackRecommendationReason.RetryTransientFailure,
            priority: 'secondary',
            ...overrides,
        } as PlaybackRecommendation;
    }
    if (action === 'alternative-source') {
        return {
            action,
            reason: PlaybackRecommendationReason.AlternativeSourceAvailable,
            priority: 'secondary',
            ...overrides,
        } as PlaybackRecommendation;
    }
    return {
        action,
        target: 'html5',
        reason: PlaybackRecommendationReason.DifferentEngineFamily,
        priority: 'secondary',
        ...overrides,
    } as PlaybackRecommendation;
}

function source(index: number): VodSourceDescriptor {
    return {
        id: `playlist-${index}:xtream:${index}`,
        playlistId: `playlist-${index}`,
        playlistName: `Portal ${index}`,
        portalType: 'xtream',
        contentId: index,
        rawTitle: `Example Movie ${index}`,
        matchConfidence: 'exact',
        isActive: false,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
    };
}

describe('PlaybackDiagnosticPanelComponent', () => {
    let fixture: ComponentFixture<PlaybackDiagnosticPanelComponent>;
    let component: PlaybackDiagnosticPanelComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                PlaybackDiagnosticPanelComponent,
                TranslateModule.forRoot(),
            ],
        })
            .overrideComponent(PlaybackDiagnosticPanelComponent, {
                add: { styles: [PANEL_STYLE_SOURCE] },
            })
            .compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PLAYBACK_DIAGNOSTICS: {
                ACTION_TRY_PLAYER: 'Try {{player}}',
                ACTION_TRY_PLAYER_HINT:
                    'This temporary player change applies only to the current playback session and leaves your saved preference unchanged.',
                REASON_DIFFERENT_ENGINE_FAMILY:
                    'This player uses a different playback engine that may support the stream format more reliably.',
                RECOMMENDATIONS_LABEL: 'Recommended recovery actions',
            },
            PORTALS: {
                MULTI_SOURCE: {
                    MORE_SOURCES: '{{count}} more sources',
                    TRY_ANOTHER_SOURCE: 'Try another source',
                },
            },
        });
        translate.use('en');

        fixture = TestBed.createComponent(PlaybackDiagnosticPanelComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('diagnostic', DIAGNOSTIC);
        fixture.componentRef.setInput('recommendations', []);
        fixture.componentRef.setInput('playback', PLAYBACK);
        fixture.componentRef.setInput('supportsManagedExternalPlayers', false);
    });

    it('applies the component host style from the actual panel stylesheet', () => {
        fixture.detectChanges();

        const host = fixture.nativeElement as HTMLElement;

        expect(getComputedStyle(host).display).toBe('contents');
    });

    it('renders supplied policy-ranked action buttons in order with priority styling', () => {
        const rankedRecommendations = [
            recommendation('player', {
                target: 'html5',
                priority: 'primary',
            }),
            recommendation('player', { target: 'mpv' }),
            recommendation('retry'),
        ];

        fixture.componentRef.setInput('recommendations', rankedRecommendations);
        fixture.detectChanges();

        const cards = fixture.debugElement.queryAll(
            By.css('.web-player-diagnostic__player-card')
        );

        expect(cards.map((card) => card.attributes['data-test-id'])).toEqual([
            'playback-recommendation-html5',
            'playback-fallback-mpv',
            'playback-retry',
        ]);
        expect(
            cards.map(
                (card) =>
                    card.classes[
                        'web-player-diagnostic__player-card--primary'
                    ] ?? false
            )
        ).toEqual([true, false, false]);
        for (const card of cards) {
            const button = card.nativeElement as HTMLButtonElement;

            expect(button.tagName).toBe('BUTTON');
            expect(button.getAttribute('type')).toBe('button');
            expect(button.type).toBe('button');
        }
    });

    it('exposes the recommendation set and alternatives with native grouping semantics', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('alternative-source', { priority: 'primary' }),
        ]);
        fixture.componentRef.setInput('alternativeSources', [source(1)]);
        fixture.detectChanges();

        const group = fixture.nativeElement.querySelector(
            '.web-player-diagnostic__recommendations'
        ) as HTMLElement;
        const alternatives = fixture.nativeElement.querySelector(
            '[data-test-id="playback-alternative-sources"]'
        ) as HTMLFieldSetElement;
        const legend = alternatives.firstElementChild as HTMLElement;

        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-label')).toBe(
            'Recommended recovery actions'
        );
        expect(legend.tagName).toBe('LEGEND');
        expect(legend.classList).toContain(
            'web-player-diagnostic__alternatives-title'
        );
        expect(legend.textContent).toContain('Try another source');
    });

    it('provides a high-contrast dark token contract to alternative source rows', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('alternative-source', { priority: 'primary' }),
        ]);
        fixture.componentRef.setInput('alternativeSources', [source(1)]);
        fixture.detectChanges();

        const alternatives = fixture.nativeElement.querySelector(
            '[data-test-id="playback-alternative-sources"]'
        ) as HTMLFieldSetElement;
        const styles = getComputedStyle(alternatives);
        const token = (name: string): string =>
            styles.getPropertyValue(name).trim();
        const expectedTokens: Readonly<Record<string, string>> = {
            '--playback-diagnostic-source-surface': '#161b24',
            '--playback-diagnostic-source-foreground': '#f3f6fb',
            '--playback-diagnostic-source-muted': '#b9c2d3',
            '--playback-diagnostic-source-accent': '#8bb7ff',
            '--playback-diagnostic-source-on-accent': '#151515',
            '--playback-diagnostic-source-hover': '#252d3b',
            '--playback-diagnostic-source-selected': '#243b5c',
            '--playback-diagnostic-source-border': '#657086',
            '--playback-diagnostic-source-ok-foreground': '#4ade80',
            '--playback-diagnostic-source-ok-surface': '#173928',
            '--playback-diagnostic-source-warn-foreground': '#ffcf99',
            '--playback-diagnostic-source-warn-surface': '#422e1d',
            '--playback-diagnostic-source-bad-foreground': '#ff9aa6',
            '--playback-diagnostic-source-bad-surface': '#451f27',
        };

        expect(alternatives.classList).toContain('dark-theme');
        for (const [name, value] of Object.entries(expectedTokens)) {
            expect(token(name)).toBe(value);
        }
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-on-surface:\s*var\(--playback-diagnostic-source-foreground\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-eyebrow-color:\s*var\(--playback-diagnostic-source-muted\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-card-hover-bg:\s*var\(--playback-diagnostic-source-hover\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-selection-surface:\s*var\(--playback-diagnostic-source-selected\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-selection-color:\s*var\(--playback-diagnostic-source-accent\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-widget-border:\s*var\(--playback-diagnostic-source-border\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--app-widget-bg:\s*var\(--playback-diagnostic-source-surface\)/
        );
        expect(PANEL_STYLE_SOURCE).toMatch(
            /--mat-sys-on-primary:\s*var\(--playback-diagnostic-source-on-accent\)/
        );
        expect(PANEL_STYLE_SOURCE).toContain('--vod-source-ok-fg:');
        expect(PANEL_STYLE_SOURCE).toContain('--vod-source-warn-fg:');
        expect(PANEL_STYLE_SOURCE).toContain('--vod-source-bad-fg:');
        expect(PANEL_STYLE_SOURCE).toMatch(
            /web-player-diagnostic__alternatives app-vod-source-row[\s\S]*--vod-source-ok-fg:/
        );

        const color = (name: string): string => expectedTokens[name];
        const surface = color('--playback-diagnostic-source-surface');
        for (const foreground of [
            '--playback-diagnostic-source-foreground',
            '--playback-diagnostic-source-muted',
            '--playback-diagnostic-source-accent',
        ]) {
            expect(
                contrastRatio(color(foreground), surface)
            ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
            contrastRatio(color('--playback-diagnostic-source-border'), surface)
        ).toBeGreaterThanOrEqual(3);
        for (const tone of ['ok', 'warn', 'bad']) {
            expect(
                contrastRatio(
                    color(`--playback-diagnostic-source-${tone}-foreground`),
                    color(`--playback-diagnostic-source-${tone}-surface`)
                )
            ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
            contrastRatio(
                color('--playback-diagnostic-source-on-accent'),
                color('--playback-diagnostic-source-accent')
            )
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('disables recommendation buttons and source controls while pending', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('retry', { priority: 'primary' }),
            recommendation('alternative-source'),
        ]);
        fixture.componentRef.setInput('alternativeSources', [source(1)]);
        fixture.componentRef.setInput('pending', true);
        fixture.detectChanges();

        const retry = fixture.nativeElement.querySelector(
            '[data-test-id="playback-retry"]'
        ) as HTMLButtonElement;
        const alternatives = fixture.nativeElement.querySelector(
            '[data-test-id="playback-alternative-sources"]'
        ) as HTMLFieldSetElement;
        const sourcePlay = fixture.nativeElement.querySelector(
            '.source-row__action--play'
        ) as HTMLButtonElement;

        expect(retry.disabled).toBe(true);
        expect(alternatives.disabled).toBe(true);
        expect(sourcePlay.matches(':disabled')).toBe(true);
    });

    it('bounds alternative sources to five and reports the hidden count', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('alternative-source', { priority: 'primary' }),
        ]);
        fixture.componentRef.setInput(
            'alternativeSources',
            Array.from({ length: 7 }, (_, index) => source(index + 1))
        );
        fixture.detectChanges();

        expect(
            fixture.debugElement.queryAll(By.css('app-vod-source-row'))
        ).toHaveLength(5);
        expect(
            fixture.nativeElement.querySelector(
                '.web-player-diagnostic__alternatives-more'
            ).textContent
        ).toContain('2');
    });

    it('emits exact retry, player, source play, and source check requests', () => {
        const retries: void[] = [];
        const players: PlaybackRecommendationTarget[] = [];
        const playedSources: string[] = [];
        const checkedSources: string[] = [];
        component.retryRequested.subscribe(() => retries.push(undefined));
        component.playerRequested.subscribe((target) => players.push(target));
        component.alternativeSourceRequested.subscribe((id) =>
            playedSources.push(id)
        );
        component.sourceCheckRequested.subscribe((id) =>
            checkedSources.push(id)
        );
        fixture.componentRef.setInput('recommendations', [
            recommendation('player', {
                target: 'artplayer',
                priority: 'primary',
            }),
            recommendation('retry'),
            recommendation('alternative-source'),
        ]);
        fixture.componentRef.setInput('alternativeSources', [source(8)]);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="playback-recommendation-artplayer"]'
            ) as HTMLButtonElement
        ).click();
        (
            fixture.nativeElement.querySelector(
                '[data-test-id="playback-retry"]'
            ) as HTMLButtonElement
        ).click();
        (
            fixture.nativeElement.querySelector(
                '.source-row__action--play'
            ) as HTMLButtonElement
        ).click();
        (
            fixture.nativeElement.querySelector(
                '.source-tag--action'
            ) as HTMLButtonElement
        ).click();

        expect(players).toEqual(['artplayer']);
        expect(retries).toEqual([undefined]);
        expect(playedSources).toEqual(['playlist-8:xtream:8']);
        expect(checkedSources).toEqual(['playlist-8:xtream:8']);
    });

    it('always renders Copy URL and Technical details utilities', () => {
        fixture.detectChanges();

        const copy = fixture.nativeElement.querySelector(
            '[data-test-id="playback-copy-url"]'
        ) as HTMLButtonElement;
        const details = fixture.nativeElement.querySelector(
            '[data-test-id="playback-diagnostic-details"]'
        ) as HTMLDetailsElement;

        expect(copy).not.toBeNull();
        expect(copy.type).toBe('button');
        expect(copy.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.ACTION_COPY_URL'
        );
        expect(details).not.toBeNull();
        expect(details.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.DETAILS_SUMMARY'
        );
    });

    it('uses runtime capability for browser-access guidance without implying an external action', () => {
        const browserIssue: PlaybackDiagnostic = {
            ...DIAGNOSTIC,
            code: PlaybackDiagnosticCode.BrowserAccessError,
        };
        fixture.componentRef.setInput('diagnostic', browserIssue);
        fixture.componentRef.setInput('supportsManagedExternalPlayers', true);
        fixture.componentRef.setInput('recommendations', []);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="playback-fallback-mpv"], [data-test-id="playback-fallback-vlc"]'
            )
        ).toBeNull();
    });

    it('uses PWA browser-access guidance when managed external players are unavailable', () => {
        fixture.componentRef.setInput('diagnostic', {
            ...DIAGNOSTIC,
            code: PlaybackDiagnosticCode.BrowserAccessError,
        });
        fixture.componentRef.setInput('supportsManagedExternalPlayers', false);
        fixture.componentRef.setInput('recommendations', []);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION'
        );
    });

    it('uses a native headline only when an external player is ranked', () => {
        fixture.componentRef.setInput('diagnostic', {
            ...DIAGNOSTIC,
            code: PlaybackDiagnosticCode.BrowserAccessError,
        });
        fixture.componentRef.setInput('supportsManagedExternalPlayers', true);
        fixture.componentRef.setInput('recommendations', [
            recommendation('player', {
                target: 'vlc',
                priority: 'primary',
                reason: PlaybackRecommendationReason.ExternalBrowserAccess,
            }),
        ]);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.DESCRIPTION'
        );
    });

    it('does not infer external recovery copy for DRM without a ranked external target', () => {
        fixture.componentRef.setInput('diagnostic', {
            ...DIAGNOSTIC,
            code: PlaybackDiagnosticCode.DrmOrEncryption,
        });
        fixture.componentRef.setInput('supportsManagedExternalPlayers', true);
        fixture.componentRef.setInput('recommendations', [
            recommendation('alternative-source', { priority: 'primary' }),
        ]);
        fixture.componentRef.setInput('alternativeSources', [source(1)]);
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
        );
        expect(fixture.nativeElement.textContent).not.toContain(
            'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE'
        );
    });

    it('shows the temporary hint only for built-in player targets', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('player', {
                target: 'videojs',
                priority: 'primary',
            }),
            recommendation('player', { target: 'mpv' }),
            recommendation('player', { target: 'vlc' }),
        ]);
        fixture.detectChanges();

        const builtIn = fixture.nativeElement.querySelector(
            '[data-test-id="playback-recommendation-videojs"]'
        ) as HTMLButtonElement;
        const mpv = fixture.nativeElement.querySelector(
            '[data-test-id="playback-fallback-mpv"]'
        ) as HTMLButtonElement;
        const vlc = fixture.nativeElement.querySelector(
            '[data-test-id="playback-fallback-vlc"]'
        ) as HTMLButtonElement;

        expect(builtIn.textContent).toContain(
            'leaves your saved preference unchanged'
        );
        expect(mpv.textContent).not.toContain(
            'leaves your saved preference unchanged'
        );
        expect(vlc.textContent).not.toContain(
            'leaves your saved preference unchanged'
        );
    });

    it('wraps long translated reasons and temporary hints without clipping', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('player', {
                target: 'videojs',
                priority: 'primary',
            }),
        ]);
        fixture.detectChanges();

        const hints = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.web-player-diagnostic__player-hint'
            ) as NodeListOf<HTMLElement>
        );

        expect(hints).toHaveLength(2);
        expect(hints[0].textContent).toContain(
            'different playback engine that may support the stream format'
        );
        expect(hints[1].textContent).toContain(
            'leaves your saved preference unchanged'
        );
        for (const hint of hints) {
            const styles = getComputedStyle(hint);
            expect(styles.whiteSpace).toBe('normal');
            expect(styles.overflowWrap).toBe('anywhere');
            expect(styles.textOverflow).toBe('clip');
            expect(styles.overflow).not.toBe('hidden');
        }
    });

    it('uses native focus order without autofocus or a focus trap', () => {
        fixture.componentRef.setInput('recommendations', [
            recommendation('retry', { priority: 'primary' }),
        ]);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('[autofocus], [cdkTrapFocus]')
        ).toBeNull();
        expect(document.activeElement).not.toBe(
            fixture.nativeElement.querySelector(
                '[data-test-id="playback-retry"]'
            )
        );
    });

    it('declares focus, container-query, and drag-region CSS contracts for browser integration', () => {
        const styles = PANEL_STYLE_SOURCE;

        expect(styles).toContain(
            '.web-player-diagnostic__player-card:focus-visible'
        );
        expect(styles).toContain('outline: 2px solid #ffb24c');
        expect(styles).toContain('@container (max-width: 520px)');
        expect(styles).toMatch(
            /web-player-diagnostic__recommendations[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/
        );
        expect(styles).toContain('flex-wrap: wrap');
        expect(styles).toContain('min-width: 0');
        expect(styles).toContain('overflow-wrap: anywhere');
        expect(styles).toContain('app-region: no-drag');
    });
});
