import { PerceptualComparator } from '../compare/comparator.js';
import type { CompareOptions, ImageComparator } from '../compare/types.js';
import type { ComparatorOption } from './types.js';

export const comparatorFor = (options: CompareOptions & ComparatorOption): ImageComparator =>
  options.comparator ?? new PerceptualComparator(options);
