import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { injectTranslationTick } from './translation-tick';

/** A loader whose dictionaries arrive only when the test sends them. */
class DelayedLoader implements TranslateLoader {
    readonly pending = new Map<string, Subject<Record<string, unknown>>>();

    getTranslation(lang: string): Observable<Record<string, unknown>> {
        const subject = new Subject<Record<string, unknown>>();
        this.pending.set(lang, subject);
        return subject;
    }

    deliver(lang: string, dictionary: Record<string, unknown>): void {
        const subject = this.pending.get(lang);
        subject?.next(dictionary);
        subject?.complete();
    }
}

function setUp(options: {
    defaultLanguage?: string;
    loader?: TranslateLoader;
}) {
    TestBed.configureTestingModule({
        imports: [
            TranslateModule.forRoot({
                defaultLanguage: options.defaultLanguage,
                loader: {
                    provide: TranslateLoader,
                    useValue: options.loader ?? {
                        getTranslation: () => of({}),
                    },
                },
            }),
        ],
    });
    const translate = TestBed.inject(TranslateService);
    const tick = TestBed.runInInjectionContext(() => injectTranslationTick());
    const label = computed(() => {
        tick();
        return translate.instant('PLAYER.TITLE');
    });
    return { translate, label };
}

describe('injectTranslationTick', () => {
    it('re-runs a computed when a start-up dictionary lands without use()', () => {
        const loader = new DelayedLoader();
        const { label } = setUp({ defaultLanguage: 'en', loader });

        // Read before the dictionary arrives: instant answers with the key.
        expect(label()).toBe('PLAYER.TITLE');

        loader.deliver('en', { PLAYER: { TITLE: 'Player' } });

        expect(label()).toBe('Player');
    });

    it('re-runs a computed when the dictionary of use() arrives late', () => {
        const loader = new DelayedLoader();
        const { translate, label } = setUp({ loader });

        translate.use('ru');
        expect(label()).toBe('PLAYER.TITLE');

        loader.deliver('ru', { PLAYER: { TITLE: 'Плеер' } });

        expect(label()).toBe('Плеер');
    });

    it('re-runs a computed on a runtime language switch', () => {
        const { translate, label } = setUp({});
        translate.setTranslation('en', { PLAYER: { TITLE: 'Player' } });
        translate.setTranslation('ru', { PLAYER: { TITLE: 'Плеер' } });
        translate.use('en');
        expect(label()).toBe('Player');

        translate.use('ru');

        expect(label()).toBe('Плеер');
    });

    it('re-runs a computed when the current dictionary is updated', () => {
        const { translate, label } = setUp({});
        translate.setTranslation('en', { PLAYER: { TITLE: 'Player' } });
        translate.use('en');
        expect(label()).toBe('Player');

        translate.setTranslation('en', { PLAYER: { TITLE: 'Media player' } });

        expect(label()).toBe('Media player');
    });
});
