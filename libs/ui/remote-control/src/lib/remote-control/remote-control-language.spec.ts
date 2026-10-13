import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    REMOTE_CONTROL_TRANSLATIONS,
    resolveRemoteControlLanguage,
} from './remote-control-language';

describe('resolveRemoteControlLanguage', () => {
    it.each([
        [['de-DE', 'en'], 'de', 'de-DE'],
        [['fr'], 'fr', 'fr'],
        [['zh-TW'], 'zhtw', 'zh-TW'],
        [['zh-Hant-HK'], 'zhtw', 'zh-Hant-HK'],
        [['zh-CN'], 'zh', 'zh-CN'],
        [['be-BY'], 'by', 'be-BY'],
        [['ar-MA'], 'ary', 'ar-MA'],
        [['ar-EG'], 'ar', 'ar-EG'],
        [['pt_BR'], 'pt', 'pt_BR'],
    ])(
        'maps %j to the %s translation',
        (languages, translation, documentLanguage) => {
            expect(resolveRemoteControlLanguage(languages)).toEqual({
                translation,
                documentLanguage,
            });
        }
    );

    it('skips languages without a translation', () => {
        expect(resolveRemoteControlLanguage(['sv-SE', 'ru-RU'])).toEqual({
            translation: 'ru',
            documentLanguage: 'ru-RU',
        });
    });

    it('falls back to English', () => {
        expect(resolveRemoteControlLanguage(['sv-SE'])).toEqual({
            translation: 'en',
            documentLanguage: 'en',
        });
        expect(resolveRemoteControlLanguage([])).toEqual({
            translation: 'en',
            documentLanguage: 'en',
        });
    });

    it('lists exactly the translation files the page loads', () => {
        const directory = resolve(
            __dirname,
            '../../../../../../apps/web/src/assets/i18n'
        );
        const files = readdirSync(directory)
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.replace(/\.json$/, ''))
            .sort();

        expect([...REMOTE_CONTROL_TRANSLATIONS].sort()).toEqual(files);
    });
});
