import { Component, OnInit, inject } from '@angular/core';
import { RemoteControlComponent } from 'remote-control';
import { TranslateService } from '@ngx-translate/core';

@Component({
    imports: [RemoteControlComponent],
    selector: 'app-root',
    templateUrl: './app.html',
    styleUrl: './app.scss',
})
export class App implements OnInit {
    private translate = inject(TranslateService);

    ngOnInit() {
        // Set default language
        this.translate.setDefaultLang('en');
        this.translate.use('en');
    }
}
