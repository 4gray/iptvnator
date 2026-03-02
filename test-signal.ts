import { signal } from '@angular/core';
const sig = signal<any>(undefined);
console.log(!!sig());
