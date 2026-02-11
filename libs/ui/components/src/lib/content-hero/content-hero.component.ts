import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';

@Component({
    selector: 'app-content-hero',
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatButtonModule,
        NgxSkeletonLoaderComponent,
    ],
    templateUrl: './content-hero.component.html',
    styleUrls: ['./content-hero.component.scss'],
})
export class ContentHeroComponent {
    readonly title = input<string>();
    readonly description = input<string>();
    readonly posterUrl = input<string>();
    readonly backdropUrl = input<string>();
    readonly isLoading = input(false);
    readonly errorMessage = input<string>();

    readonly backClicked = output<void>();

    onBack(): void {
        this.backClicked.emit();
    }
}
