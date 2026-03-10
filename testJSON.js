import { parseNMEJSON } from './src/shaderConverter.js';
import fs from 'fs';

const jsonStr = fs.readFileSync('./test_shader.json', 'utf8');

try {
    const result = parseNMEJSON(jsonStr);
    console.log('=== GENERATED GLSL ===');
    console.log(result.glsl);
    console.log('\n=== CONFIG ===');
    console.log('uniforms:', result.uniforms);
    console.log('samplers:', result.samplers);
    console.log('defaultValues:', result.defaultValues);
    console.log('hasAlpha:', result.hasAlpha);
    console.log('warnings:', result.warnings);
} catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
}
