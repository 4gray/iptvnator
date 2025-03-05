import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
    selector: 'app-loading-overlay',
    standalone: true,
    imports: [MatProgressBarModule, CommonModule],
    template: `
        <div class="overlay">
            <div class="progress-container">
                <h3>Loading playlist...</h3>
                @if (current() !== 0 && total() !== 0) {
                    <mat-progress-bar
                        mode="determinate"
                        [value]="(current() / total()) * 100"
                    />
                    <p>{{ current() }} / {{ total() }}</p>
                } @else {
                    <mat-progress-bar mode="indeterminate" />
                }
            </div>
        </div>
    `,
    styles: [
        `
            .overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .progress-container {
                padding: 2rem;
                border-radius: 8px;
                min-width: 300px;
                text-align: center;

                h3 {
                    margin-top: 0;
                }
            }
        `,
    ],
})
export class LoadingOverlayComponent {
    current = input(0);
    total = input(0);
}
