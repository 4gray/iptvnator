import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AppFormFieldModule } from './app-form-field.module';

@Component({
    imports: [AppFormFieldModule, MatInputModule],
    template: `
        <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput />
            <mat-hint>Short</mat-hint>
        </mat-form-field>
    `,
})
class WithDefaultsComponent {}

@Component({
    imports: [MatFormFieldModule, MatInputModule],
    template: `
        <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput />
        </mat-form-field>
    `,
})
class WithoutDefaultsComponent {}

function formField(component: typeof WithDefaultsComponent): HTMLElement {
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('mat-form-field');
}

describe('AppFormFieldModule', () => {
    it('gives a form field the outlined appearance and dynamic subscript', () => {
        const field = formField(WithDefaultsComponent);

        expect(field.classList).toContain('mat-form-field-appearance-outline');
        expect(field.querySelector('.mdc-notched-outline')).not.toBeNull();
        // Dynamic sizing reserves no empty subscript row below the field.
        expect(
            field.querySelector('.mat-mdc-form-field-subscript-dynamic-size')
        ).not.toBeNull();
    });

    it('is the only source of those defaults: Material alone renders filled', () => {
        const field = formField(WithoutDefaultsComponent);

        expect(field.classList).toContain('mat-form-field-appearance-fill');
        expect(field.querySelector('.mdc-notched-outline')).toBeNull();
    });
});
