import {
    Component,
    OnInit,
    inject,
    ChangeDetectionStrategy,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
    RemoteControlComponent,
    resolveRemoteControlLanguage,
} from '@iptvnator/ui/remote-control';
import { TranslateService } from '@ngx-translate/core';

@Component({
    imports: [RemoteControlComponent],
    selector: 'app-root',
    templateUrl: './app.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './app.scss',
})
export class App implements OnInit {
    private translate = inject(TranslateService);
    private document = inject(DOCUMENT);

    ngOnInit() {
        const navigator = this.document.defaultView?.navigator;
        const language = resolveRemoteControlLanguage(
            navigator?.languages?.length
                ? navigator.languages
                : [navigator?.language ?? 'en']
        );
        this.document.documentElement.lang = language.documentLanguage;
        this.translate.setDefaultLang('en');
        this.translate.use(language.translation);
    }
}
