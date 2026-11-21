import { ClipboardModule } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VodSourceRowComponent } from '@iptvnator/ui/components';
import { PlaybackDiagnosticPanelComponent } from '../playback-diagnostic-panel/playback-diagnostic-panel.component';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import type { Provider, Type } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
    StubArtPlayerComponent,
    StubEmbeddedMpvPlayerComponent,
    StubSecondStreamComponent,
    StubFullscreenChannelPanelComponent,
    StubHtmlVideoPlayerComponent,
    StubVjsPlayerComponent,
} from './web-player-view.spec-stubs';

export async function configureWebPlayerViewTest(
    component: Type<unknown>,
    providers: Provider[]
): Promise<void> {
    await TestBed.configureTestingModule({
        // @defer blocks render their main content synchronously in tests.
        deferBlockBehavior: DeferBlockBehavior.Playthrough,
        imports: [component, TranslateModule.forRoot()],
        providers,
    })
        .overrideComponent(component, {
            set: {
                imports: [
                    StubArtPlayerComponent,
                    StubEmbeddedMpvPlayerComponent,
                    StubSecondStreamComponent,
                    StubFullscreenChannelPanelComponent,
                    StubHtmlVideoPlayerComponent,
                    StubVjsPlayerComponent,
                    PlaybackDiagnosticPanelComponent,
                    // Real, not stubbed: the point of the test below is
                    // that this row's Check action reaches the host.
                    VodSourceRowComponent,
                    ClipboardModule,
                    MatButtonModule,
                    MatIconModule,
                    MatMenuModule,
                    MatTooltipModule,
                    TranslateModule,
                ],
            },
        })
        .compileComponents();
}
