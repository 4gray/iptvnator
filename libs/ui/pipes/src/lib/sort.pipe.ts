import { Injectable, Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'sortBy',
    standalone: true,
})
@Injectable()
export class SortPipe implements PipeTransform {
    transform(array: any[], sortType: string): any {
        if (!array || !sortType) {
            return array;
        }
        return array.sort((a, b) => {
            if (sortType === 'date') {
              return parseInt(b.added) - parseInt(a.added);
            } else if (sortType === 'rating') {
              const ratingA = isNaN(parseFloat(a.rating)) ? 0 : parseFloat(a.rating);
              const ratingB = isNaN(parseFloat(b.rating)) ? 0 : parseFloat(b.rating);
              return ratingB - ratingA;
            } else if (sortType === 'alpha') {
              return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            } else {
              return 0;
            }
        });
    }
}
