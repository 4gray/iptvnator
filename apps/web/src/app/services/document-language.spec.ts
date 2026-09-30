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
});
