import { DOCUMENT } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { syncDocumentLanguage, toDocumentLanguage } from './document-language';

@Component({ template: '' })
class HostComponent {
    constructor() {
        syncDocumentLanguage();
    }
}

describe('document language', () => {
    it.each([
        ['ru', 'ru'],
        ['by', 'be'],
        ['zhtw', 'zh-TW'],
        ['tr', 'tr'],
        ['', 'en'],
        [undefined, 'en'],
    ])('maps %p to <html lang="%s">', (appLanguage, expected) => {
        expect(toDocumentLanguage(appLanguage)).toBe(expected);
    });

    it('follows every UI language change', () => {
        TestBed.configureTestingModule({
            imports: [HostComponent, TranslateModule.forRoot()],
        });
        const translate = TestBed.inject(TranslateService);
        const document = TestBed.inject(DOCUMENT);
        translate.setDefaultLang('en');

        TestBed.createComponent(HostComponent);
        expect(document.documentElement.lang).toBe('en');

        translate.use('by');
        expect(document.documentElement.lang).toBe('be');

        translate.use('tr');
        expect(document.documentElement.lang).toBe('tr');
    });

    it('follows the fallback language while no language is active', () => {
        // Startup seeds the fallback from the stored hint, then resets it to
        // English when no settings exist, without ever calling use().
        TestBed.configureTestingModule({
            imports: [
                HostComponent,
                TranslateModule.forRoot({ defaultLanguage: 'ru' }),
            ],
        });
        const translate = TestBed.inject(TranslateService);
        const document = TestBed.inject(DOCUMENT);

        TestBed.createComponent(HostComponent);
        expect(document.documentElement.lang).toBe('ru');

        translate.setDefaultLang('en');
        expect(document.documentElement.lang).toBe('en');

        translate.use('el');
        translate.setDefaultLang('ru');
        expect(document.documentElement.lang).toBe('el');
    });
});
