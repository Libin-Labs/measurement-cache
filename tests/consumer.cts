import { createMeasurementCache } from '@lp-labs/measurement-cache';
const count: number = createMeasurementCache(() => []).size;
void count;
