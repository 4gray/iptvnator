import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { ProviderImportCandidate } from '@iptvnator/shared/interfaces';
import { AutoImportComponent } from './auto-import.component';

describe('AutoImportComponent', () => {
    let component: AutoImportComponent;
    let fixture: ComponentFixture<AutoImportComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [AutoImportComponent, TranslateModule.forRoot()],
            providers: [provideNoopAnimations()],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(AutoImportComponent);
        component = fixture.componentInstance;
    });

    it('computes candidates from the pasted text', () => {
        fixture.detectChanges();

        component.textControl.setValue(
            'https://lists.example.com/main.m3u'
        );

        expect(component.candidates()).toHaveLength(1);
        expect(component.candidates()[0].kind).toBe('m3u-url');
    });

    it('restores the dialog-held text so a method switch does not lose the paste', () => {
        fixture.componentRef.setInput(
            'initialText',
            'MAC: 00:1A:79:12:34:56'
        );

        fixture.detectChanges();

        expect(component.textControl.value).toBe('MAC: 00:1A:79:12:34:56');
        expect(component.candidates()[0]?.kind).toBe('stalker');
    });

    it('reports edits back to the dialog', () => {
        fixture.detectChanges();
        const emitted: string[] = [];
        component.textChanged.subscribe((value) => emitted.push(value));

        component.textControl.setValue('some text');

        expect(emitted).toEqual(['some text']);
    });

    it('clears the textarea and the candidates', () => {
        fixture.detectChanges();
        component.textControl.setValue('https://lists.example.com/main.m3u');

        component.clearForm();

        expect(component.textControl.value).toBe('');
        expect(component.candidates()).toHaveLength(0);
    });

    it('emits the picked candidate', () => {
        fixture.detectChanges();
        const emitted: ProviderImportCandidate[] = [];
        component.candidateSelected.subscribe((candidate) =>
            emitted.push(candidate)
        );
        const candidate: ProviderImportCandidate = {
            kind: 'xtream',
            confidence: 'high',
            username: 'alice',
        };

        component.selectCandidate(candidate);

        expect(emitted).toEqual([candidate]);
    });

    it('masks the query password of an M3U link on the card', () => {
        fixture.detectChanges();

        const rows = component.summaryRows({
            kind: 'm3u-url',
            confidence: 'low',
            url: 'http://tv.example.com:8080/get.php?username=alice&password=s3cret&type=m3u_plus',
        });

        expect(rows[0].value).toContain('username=alice');
        expect(rows[0].value).toContain('password=••••••');
        expect(JSON.stringify(rows)).not.toContain('s3cret');
    });

    it('masks an HTTP Basic password embedded in the URL', () => {
        fixture.detectChanges();

        const rows = component.summaryRows({
            kind: 'm3u-url',
            confidence: 'high',
            url: 'https://alice:s3cret@lists.example.com/list.m3u',
        });

        expect(rows[0].value).toBe(
            'https://alice:••••••@lists.example.com/list.m3u'
        );
        expect(rows[0].value).not.toContain('s3cret');
    });

    it('masks percent-encoded and repeated password parameters', () => {
        fixture.detectChanges();

        const rows = component.summaryRows({
            kind: 'm3u-url',
            confidence: 'low',
            // `pass%77ord` is what URLSearchParams — and the importer — read
            // as `password`, so the card must hide it too.
            url: 'http://tv.example.com/get.php?pass%77ord=first&username=alice&password=second',
        });

        expect(rows[0].value).toContain('username=alice');
        expect(rows[0].value).not.toContain('first');
        expect(rows[0].value).not.toContain('second');
        expect(rows[0].value).toContain('pass%77ord=••••••');
        expect(rows[0].value).toContain('password=••••••');
    });

    it('masks the password in the summary rows', () => {
        fixture.detectChanges();

        const rows = component.summaryRows({
            kind: 'xtream',
            confidence: 'high',
            serverUrl: 'http://tv.example.com:8080',
            username: 'alice',
            password: 's3cret',
        });

        const passwordRow = rows.find(
            (row) => row.labelKey === 'HOME.XTREAM_PLAYLIST.PASSWORD'
        );
        expect(passwordRow?.value).toBe('••••••');
        expect(JSON.stringify(rows)).not.toContain('s3cret');
    });
});
