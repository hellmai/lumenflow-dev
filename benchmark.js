import { buildDependencyGraph } from './packages/@lumenflow/core/src/dependency-graph.js';
import { performance } from 'perf_hooks';

console.log('Starting benchmark...');
const start = performance.now();
const graph = buildDependencyGraph();
const end = performance.now();

console.log(`Graph size: ${graph.size}`);
console.log(`Time taken: ${(end - start).toFixed(2)}ms`);
