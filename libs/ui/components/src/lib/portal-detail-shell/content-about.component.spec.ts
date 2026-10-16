import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ContentAboutComponent } from './content-about.component';

describe('ContentAboutComponent', () => {
    let fixture: ComponentFixture<ContentAboutComponent>;

    const poster = (): HTMLImageElement | null =>
        (fixture.nativeElement as HTMLElement).querySelector('.about__poster');

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ContentAboutComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(ContentAboutComponent);
        fixture.componentRef.setInput('title', 'Movie Title');
    });

    it('omits the poster when there is no URL', () => {
        fixture.detectChanges();
        expect(poster()).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Movie Title');
    });

    it('drops a poster that fails to load and retries a new URL', () => {
        fixture.componentRef.setInput('posterUrl', 'https://img.test/a.jpg');
        fixture.detectChanges();
        expect(poster()?.getAttribute('src')).toBe('https://img.test/a.jpg');

        poster()?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(poster()).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Movie Title');

        fixture.componentRef.setInput('posterUrl', 'https://img.test/b.jpg');
        fixture.detectChanges();
        expect(poster()?.getAttribute('src')).toBe('https://img.test/b.jpg');
    });
});
