import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
import { VodSourcesMenuComponent } from './vod-sources-menu.component';

class FakeTranslateLoader implements TranslateLoader {
    getTranslation(): Observable<Record<string, unknown>> {
        return of({
            PORTALS: {
                MULTI_SOURCE: {
                    SOURCE: 'Source',
                    SOURCES_FOR: 'Sources for “{{title}}”',
                    MATCHED_BY_TMDB: 'matched by TMDB',
                    MATCHED_BY_TITLE: 'matched by title',
                    MATCH_BY_TITLE: 'by title',
                    AUTO_FAILOVER: 'Auto-switch on error',
                    PLAYING: 'Playing',
                    CURRENT: 'Current',
                    PLAY_FROM_SOURCE: 'Play from this source',
                    PIN_SOURCE: 'Make this the main source',
                    UNPIN_SOURCE: 'Unpin this source',
                    CHECK: 'check',
                    CHECK_TOOLTIP: 'Check availability',
                    PROBE_OK: 'available',
                    PROBE_FAIL: 'unavailable',
                    PROBE_CHECKING: 'checking',
                    OPEN_SOURCES: 'Show alternative sources',
                    CHECK_ALL: 'check all',
                    FILTER_PLACEHOLDER: 'Filter by playlist',
                    NO_MATCHES: 'No playlists match that filter',
                    COPIES: '{{count}} copies in this playlist',
                    FILTER_ALL: 'All',
                    FILTER_AVAILABLE: 'Available',
                    FILTER_HD: 'HD+',
                    ALL_LANGUAGES: 'All languages',
                    SAME_AS_ABOVE: 'same as above',
                    SHOWING_OF_TOTAL: '{{visible}} of {{total}}',
                },
            },
        });
    }
}

function createSource(
    overrides: Partial<VodSourceDescriptor> = {}
): VodSourceDescriptor {
    return {
        id: 'playlist-1:xtream:42',
        playlistId: 'playlist-1',
        playlistName: 'SharkTV',
        portalType: 'xtream',
        contentId: 42,
        rawTitle: 'Dune Part Two 2160p',
        matchConfidence: 'exact',
        year: 2024,
        isActive: false,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
        ...overrides,
    };
}

describe('VodSourcesMenuComponent', () => {
    let fixture: ComponentFixture<VodSourcesMenuComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                VodSourcesMenuComponent,
                TranslateModule.forRoot({
                    loader: {
                        provide: TranslateLoader,
                        useClass: FakeTranslateLoader,
                    },
                }),
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setDefaultLang('en');
        translate.use('en');

        fixture = TestBed.createComponent(VodSourcesMenuComponent);
    });

    function render(sources: VodSourceDescriptor[]): void {
        fixture.componentRef.setInput('sources', sources);
        fixture.detectChanges();
    }

    /** Metadata tags only — the actionable check chip is not a value. */
    function tagTexts(): string[] {
        return fixture.debugElement
            .queryAll(By.css('.source-tag:not(.source-tag--action)'))
            .map((tag) => (tag.nativeElement.textContent ?? '').trim());
    }

    function checkChip() {
        return fixture.debugElement.query(By.css('.source-tag--action'));
    }

    it('renders a stated value as a plain tag, without the guess marker', () => {
        render([
            createSource({
                quality: { value: '1080p', provenance: 'api' },
            }),
        ]);

        const qualityTag = tagTexts().find((text) => text.includes('1080p'));
        expect(qualityTag).toBeDefined();
        expect(qualityTag).not.toContain('~');
        expect(
            fixture.debugElement.queryAll(By.css('.source-tag--warn')).length
        ).toBe(0);
    });

    it('marks a parsed value as a guess with ~ and the warn tone', () => {
        render([
            createSource({
                quality: { value: '2160p', provenance: 'parsed' },
            }),
        ]);

        const warnTags = fixture.debugElement.queryAll(
            By.css('.source-tag--warn')
        );
        expect(warnTags.length).toBe(1);

        const text = (warnTags[0].nativeElement.textContent ?? '').trim();
        expect(text).toContain('~');
        expect(text).toContain('2160p');
    });

    it('renders no tag for an unknown field and offers the check chip instead', () => {
        render([
            createSource({
                quality: undefined,
                codec: undefined,
                container: { value: 'mkv', provenance: 'api' },
                audio: undefined,
                probe: { status: 'ok', latencyMs: 120 },
            }),
        ]);

        const texts = tagTexts().join(' | ');
        expect(texts).not.toContain('unknown');
        expect(texts).not.toContain('—');
        // Portal type, the one known field, and the probe outcome — nothing else.
        expect(tagTexts().length).toBe(3);
        expect(checkChip()).not.toBeNull();
    });

    it('never renders an unchecked probe as offline and keeps offering the check', () => {
        render([
            createSource({
                quality: { value: '1080p', provenance: 'api' },
                codec: { value: 'h264', provenance: 'api' },
                container: { value: 'mkv', provenance: 'api' },
                audio: { value: 'rus', provenance: 'api' },
                probe: { status: 'unknown' },
            }),
        ]);

        expect(
            fixture.debugElement.queryAll(By.css('.source-tag--bad')).length
        ).toBe(0);
        expect(tagTexts().join(' | ')).not.toContain('unavailable');
        expect(checkChip()).not.toBeNull();
    });

    it('renders a successful probe with its latency in seconds', () => {
        render([
            createSource({
                quality: { value: '1080p', provenance: 'api' },
                codec: { value: 'h264', provenance: 'api' },
                container: { value: 'mkv', provenance: 'api' },
                audio: { value: 'rus', provenance: 'api' },
                probe: { status: 'ok', latencyMs: 400 },
            }),
        ]);

        const okTag = fixture.debugElement.query(By.css('.source-tag--ok'));
        expect(okTag).not.toBeNull();

        const text = (okTag.nativeElement.textContent ?? '').trim();
        expect(text).toContain('available');
        expect(text).toContain('0.4s');
        // Nothing left unknown, so the check chip stands down.
        expect(checkChip()).toBeNull();
    });

    it('orders tags portal type → quality → codec → container → audio → probe', () => {
        render([
            createSource({
                quality: { value: '2160p', provenance: 'api' },
                codec: { value: 'hevc', provenance: 'api' },
                container: { value: 'mp4', provenance: 'api' },
                audio: { value: 'dub', provenance: 'api' },
                probe: { status: 'ok', latencyMs: 400 },
            }),
        ]);

        const texts = tagTexts();
        expect(texts[0]).toContain('Xtream');
        expect(texts[1]).toContain('2160p');
        expect(texts[2]).toContain('hevc');
        expect(texts[3]).toContain('mp4');
        expect(texts[4]).toContain('dub');
        expect(texts[5]).toContain('available');
        expect(texts.length).toBe(6);
    });

    it('flags a fuzzy match with ~ and the year that disambiguates it', () => {
        render([
            createSource({
                matchConfidence: 'fuzzy',
                year: 2024,
                quality: { value: '720p', provenance: 'api' },
            }),
        ]);

        const warnTag = fixture.debugElement.query(By.css('.source-tag--warn'));
        expect(warnTag).not.toBeNull();

        const text = (warnTag.nativeElement.textContent ?? '').trim();
        expect(text).toContain('~');
        expect(text).toContain('by title');
        expect(text).toContain('2024');
    });

    it('emits the toggled state when the footer switch is flipped', () => {
        render([createSource()]);

        const emitted: boolean[] = [];
        fixture.componentInstance.autoFailoverToggled.subscribe(
            (value: boolean) => emitted.push(value)
        );

        const toggle = fixture.debugElement.query(
            By.css('.sources-menu__toggle button[role="switch"]')
        );
        expect(toggle).not.toBeNull();

        toggle.nativeElement.click();
        fixture.detectChanges();

        expect(emitted).toEqual([true]);
    });

    it('drops the footer switch on a player that cannot report failures', () => {
        // MPV, VLC and Embedded MPV never raise the playback diagnostic that
        // drives failover, so the switch there promises something that can
        // never happen.
        render([createSource()]);
        fixture.componentRef.setInput('autoFailoverSupported', false);
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.sources-menu__toggle'))
        ).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain(
            'Auto-switch on error'
        );
    });

    it('badges the active row as Playing only while a player is running', () => {
        // Discovery marks a source active the moment the page opens, and the
        // row keeps that state after the player is closed — so an
        // unconditional "Playing" badge is a claim about nothing.
        render([createSource({ isActive: true })]);

        const badge = () =>
            (
                fixture.debugElement.query(By.css('.source-row__badge'))
                    ?.nativeElement.textContent ?? ''
            ).trim();

        expect(badge()).toBe('Current');

        fixture.componentRef.setInput('playbackLive', true);
        fixture.detectChanges();

        expect(badge()).toBe('Playing');
    });

    describe('filter chips', () => {
        function chipByText(text: string) {
            return fixture.debugElement
                .queryAll(By.css('.filter-chip'))
                .find((chip) =>
                    (chip.nativeElement.textContent ?? '').includes(text)
                );
        }

        function rowNames(): string[] {
            return fixture.debugElement
                .queryAll(By.css('.source-row__name'))
                .map((el) => (el.nativeElement.textContent ?? '').trim());
        }

        it('HD+ keeps only groups with a copy at 1080p or better', () => {
            render([
                createSource({
                    id: 'a:xtream:1',
                    playlistId: 'a',
                    playlistName: 'HD Portal',
                    quality: { value: '1080p', provenance: 'api' },
                }),
                createSource({
                    id: 'b:xtream:2',
                    playlistId: 'b',
                    playlistName: 'SD Portal',
                    quality: { value: '720p', provenance: 'api' },
                }),
            ]);

            chipByText('HD+')?.nativeElement.click();
            fixture.detectChanges();

            expect(rowNames()).toEqual(['HD Portal']);
            expect(fixture.nativeElement.textContent).toContain('1 of 2');
        });

        it('activating Available with no verdicts anywhere runs check-all', () => {
            const checked: string[] = [];
            fixture.componentInstance.checkRequested.subscribe((id: string) =>
                checked.push(id)
            );
            render([
                createSource({ id: 'a:xtream:1', playlistId: 'a' }),
                createSource({
                    id: 'b:xtream:2',
                    playlistId: 'b',
                    probe: { status: 'unknown' },
                }),
            ]);

            chipByText('Available')?.nativeElement.click();
            fixture.detectChanges();

            expect(checked).toEqual(['a:xtream:1', 'b:xtream:2']);
        });

        it('does not re-run check-all once any verdict exists', () => {
            const checked: string[] = [];
            fixture.componentInstance.checkRequested.subscribe((id: string) =>
                checked.push(id)
            );
            render([
                createSource({
                    id: 'a:xtream:1',
                    playlistId: 'a',
                    probe: { status: 'ok', latencyMs: 90 },
                }),
                createSource({ id: 'b:xtream:2', playlistId: 'b' }),
            ]);

            chipByText('Available')?.nativeElement.click();
            fixture.detectChanges();

            expect(checked).toEqual([]);
            // Only the verified source survives the filter.
            expect(
                fixture.debugElement.queryAll(By.css('app-vod-source-row'))
                    .length
            ).toBe(1);
        });

        it('builds the language select from parsed title prefixes and filters by it', () => {
            render([
                createSource({
                    id: 'a:xtream:1',
                    playlistId: 'a',
                    playlistName: 'English Portal',
                    rawTitle: 'EN| Dune (2021)',
                }),
                createSource({
                    id: 'b:xtream:2',
                    playlistId: 'b',
                    playlistName: 'Russian Portal',
                    rawTitle: 'RU| Дюна (2021)',
                }),
            ]);

            const select = fixture.debugElement.query(
                By.css('.sources-menu__lang')
            );
            const options = select.nativeElement
                .textContent as string;
            expect(options).toContain('EN');
            expect(options).toContain('RU');

            fixture.componentInstance.setLanguageFilter('RU');
            fixture.detectChanges();

            expect(rowNames()).toEqual(['Russian Portal']);
        });

        it('the All chip resets every filter and restores the full list', () => {
            render([
                createSource({
                    id: 'a:xtream:1',
                    playlistId: 'a',
                    quality: { value: '1080p', provenance: 'api' },
                }),
                createSource({ id: 'b:xtream:2', playlistId: 'b' }),
            ]);

            chipByText('HD+')?.nativeElement.click();
            fixture.detectChanges();
            expect(
                fixture.debugElement.queryAll(By.css('app-vod-source-row'))
                    .length
            ).toBe(1);

            chipByText('All')?.nativeElement.click();
            fixture.detectChanges();
            expect(
                fixture.debugElement.queryAll(By.css('app-vod-source-row'))
                    .length
            ).toBe(2);
            expect(fixture.nativeElement.textContent).not.toContain('of 2');
        });
    });

    describe('copies expansion', () => {
        function expandFirstGroup(): void {
            fixture.debugElement
                .query(By.css('.sources-menu__variants-toggle'))
                .nativeElement.click();
            fixture.detectChanges();
        }

        const primaryCopy = createSource({
            id: 'a:xtream:1',
            playlistId: 'a',
            playlistName: 'Shark Portal',
            rawTitle: 'EN| Night of the Living Dead (1968)',
            quality: { value: '720p', provenance: 'api' },
            container: { value: 'mp4', provenance: 'api' },
            isActive: true,
        });
        const hdCopy = createSource({
            id: 'a:xtream:2',
            playlistId: 'a',
            playlistName: 'Shark Portal',
            rawTitle: 'RU| Ночь живых мертвецов (1968)',
            quality: { value: '1080p', provenance: 'api' },
            container: { value: 'mp4', provenance: 'api' },
        });

        it('lists every copy with a language chip and the raw stream title', () => {
            render([primaryCopy, hdCopy]);
            expandFirstGroup();

            const copies = fixture.debugElement.queryAll(
                By.css('app-vod-source-copy-row')
            );
            expect(copies.length).toBe(2);

            const langs = fixture.debugElement
                .queryAll(By.css('.copy-row__lang'))
                .map((el) => el.nativeElement.textContent.trim());
            expect(langs).toEqual(['EN', 'RU']);

            const titles = fixture.debugElement
                .queryAll(By.css('.copy-row__title'))
                .map((el) => el.nativeElement.textContent.trim());
            expect(titles).toEqual([
                'EN| Night of the Living Dead (1968)',
                'RU| Ночь живых мертвецов (1968)',
            ]);
            // The playlist names itself once, on the parent row.
            const nameCount = fixture.debugElement.queryAll(
                By.css('.source-row__name')
            ).length;
            expect(nameCount).toBe(1);
        });

        it('shows only tags that differ from the parent copy', () => {
            render([primaryCopy, hdCopy]);
            expandFirstGroup();

            const copyTags = fixture.debugElement
                .queryAll(By.css('app-vod-source-copy-row .source-tag'))
                .map((el) => (el.nativeElement.textContent ?? '').trim());
            // The HD copy differs in quality only; the shared container and
            // the identical primary copy contribute no tags at all.
            expect(copyTags).toEqual(['1080p']);
        });

        it('marks the parent-identical copy with "same as above" instead of tags', () => {
            render([primaryCopy, hdCopy]);
            expandFirstGroup();

            const sameNotes = fixture.debugElement.queryAll(
                By.css('.copy-row__same')
            );
            expect(sameNotes.length).toBe(1);
            expect(sameNotes[0].nativeElement.textContent).toContain(
                'same as above'
            );
        });

        it('plays the exact copy that was clicked', () => {
            const played: string[] = [];
            fixture.componentInstance.playRequested.subscribe((id: string) =>
                played.push(id)
            );
            render([primaryCopy, hdCopy]);
            expandFirstGroup();

            fixture.debugElement
                .queryAll(By.css('.copy-row__action--play'))[1]
                .nativeElement.click();

            expect(played).toEqual(['a:xtream:2']);
        });
    });

    it('shows the match kind in the header, or the resume label when given', () => {
        fixture.componentRef.setInput('sources', [createSource()]);
        fixture.componentRef.setInput('matchKind', 'tmdb');
        fixture.detectChanges();

        const hint = fixture.debugElement.query(By.css('.sources-menu__hint'));
        expect(hint.nativeElement.textContent.trim()).toBe('matched by TMDB');

        fixture.componentRef.setInput(
            'resumeLabel',
            'timecode will be kept · 0:42:18'
        );
        fixture.detectChanges();

        expect(hint.nativeElement.textContent.trim()).toBe(
            'timecode will be kept · 0:42:18'
        );
    });
});
