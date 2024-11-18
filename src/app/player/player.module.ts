import { OverlayModule } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../shared/shared.module';
import { VideoPlayerComponent } from './components/video-player/video-player.component';

const routes: Routes = [{ path: '', component: VideoPlayerComponent }];

@NgModule({
    imports: [
        CommonModule,
        OverlayModule,
        RouterModule.forChild(routes),
        SharedModule,
    ],
})
export class PlayerModule {}
