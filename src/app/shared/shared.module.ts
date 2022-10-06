import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FlexLayoutModule } from '@angular/flex-layout';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { PlaylistItemComponent } from '../home/recent-playlists/playlist-item/playlist-item.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { MaterialModule } from '../material.module';
import { HeaderComponent } from './components/';
import { AboutDialogComponent } from './components/about-dialog/about-dialog.component';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';
import { FilterPipe } from './pipes/filter.pipe';
import { MomentDatePipe } from './pipes/moment-date.pipe';
@NgModule({
    declarations: [
        ConfirmDialogComponent,
        FilterPipe,
        HeaderComponent,
        MomentDatePipe,
        AboutDialogComponent,
        RecentPlaylistsComponent,
        PlaylistItemComponent,
    ],
    imports: [
        CommonModule,
        FlexLayoutModule,
        FormsModule,
        MaterialModule,
        NgxWhatsNewModule,
        ReactiveFormsModule,
        TranslateModule,
        DragDropModule,
    ],
    exports: [
        ConfirmDialogComponent,
        FilterPipe,
        FlexLayoutModule,
        FormsModule,
        HeaderComponent,
        MaterialModule,
        NgxWhatsNewModule,
        MomentDatePipe,
        ReactiveFormsModule,
        TranslateModule,
        RecentPlaylistsComponent,
        PlaylistItemComponent,
    ],
})
export class SharedModule {}
