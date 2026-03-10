import { parseNMEtoPhaser } from './src/shaderConverter.js';
import fs from 'fs';

const code = fs.readFileSync('./Panner_1.txt', 'utf8');
const r = parseNMEtoPhaser(code);
console.log('GLSL lines:', r.glsl.split('\n').length);
console.log('uniforms:', r.uniforms);
console.log('hasAlpha:', r.hasAlpha);
console.log('warnings:', r.warnings);
