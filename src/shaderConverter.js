/**
 * Babylon Node Material Editor → Babylon ShaderMaterial Converter
 *
 * Supports THREE input formats:
 *   1. JS block graph  — "Generate Code" from NME     → parseNMEtoPhaser()
 *   2. NME JSON export — "Save" / "Export" from NME    → parseNMEJSON()
 *   3. Compiled GLSL   — compiled vertex + fragment    → parseCompiledNME()
 */

// ── System value enum → name mapping ──────────────────────────────────────────
const SYS_VALUE_MAP = {
    1: 'World', 2: 'View', 3: 'Projection', 4: 'ViewProjection',
    5: 'WorldView', 6: 'WorldViewProjection', 7: 'CameraPosition',
    8: 'FogColor', 9: 'DeltaTime',
};

/**
 * Convert NME JSON serialization to the JS block-graph format that
 * parseNMEtoPhaser() already knows how to parse.
 */
export function parseNMEJSON(jsonStr) {
    let data;
    try {
        data = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error('Invalid JSON: ' + e.message);
    }

    if (!data.blocks || !Array.isArray(data.blocks)) {
        throw new Error('Not a valid NME JSON export — missing "blocks" array.');
    }

    const lines = [];

    // ── 1. Block instantiations ──────────────────────────────────────────────
    for (const block of data.blocks) {
        const type = block.customType; // e.g. "BABYLON.InputBlock"
        const varName = `b_${block.id}`;
        const displayName = (block.name || '').replace(/"/g, '\\"');
        lines.push(`var ${varName} = new ${type}("${displayName}");`);

        // ── Input block properties ────────────────────────────────────────
        if (type === 'BABYLON.InputBlock') {
            // Mode 1 = attribute
            if (block.mode === 1) {
                const attrName = (block.name || '').toLowerCase();
                lines.push(`${varName}.setAsAttribute("${attrName}");`);
            }
            // System value
            if (block.systemValue != null && SYS_VALUE_MAP[block.systemValue]) {
                lines.push(`${varName}.setAsSystemValue(BABYLON.NodeMaterialSystemValues.${SYS_VALUE_MAP[block.systemValue]});`);
            }
            // Animation type (1 = Time)
            if (block.animationType === 1) {
                lines.push(`${varName}.animationType = BABYLON.AnimatedInputBlockTypes.Time;`);
            }
            // Value
            if (block.value !== undefined && block.value !== null && block.mode !== 1) {
                if (block.valueType === 'number' || typeof block.value === 'number') {
                    lines.push(`${varName}.value = ${block.value};`);
                } else if (typeof block.value === 'object') {
                    // Color3 / Vector3 / Vector2 etc.
                    if (block.value.r !== undefined) {
                        // Color3 or Color4
                        const a = block.value.a;
                        if (a !== undefined) {
                            lines.push(`${varName}.value = new BABYLON.Color4(${block.value.r}, ${block.value.g}, ${block.value.b}, ${a});`);
                        } else {
                            lines.push(`${varName}.value = new BABYLON.Color3(${block.value.r}, ${block.value.g}, ${block.value.b});`);
                        }
                    } else if (block.value.x !== undefined) {
                        if (block.value.w !== undefined) {
                            lines.push(`${varName}.value = new BABYLON.Vector4(${block.value.x}, ${block.value.y}, ${block.value.z}, ${block.value.w});`);
                        } else if (block.value.z !== undefined) {
                            lines.push(`${varName}.value = new BABYLON.Vector3(${block.value.x}, ${block.value.y}, ${block.value.z});`);
                        } else {
                            lines.push(`${varName}.value = new BABYLON.Vector2(${block.value.x}, ${block.value.y});`);
                        }
                    }
                }
            }
        }
    }

    // ── 2. Connections ───────────────────────────────────────────────────────
    for (const block of data.blocks) {
        const dstVar = `b_${block.id}`;
        for (const input of (block.inputs || [])) {
            if (input.targetBlockId == null) continue;
            const srcVar = `b_${input.targetBlockId}`;
            const srcPort = (input.targetConnectionName || '').trim();
            const dstPort = (input.inputName || input.name || '').trim();
            if (!srcPort || !dstPort) continue;
            lines.push(`${srcVar}.${srcPort}.connectTo(${dstVar}.${dstPort});`);
        }
    }

    // ── 3. Pass through existing JS parser ───────────────────────────────────
    const jsCode = lines.join('\n');
    return parseNMEtoPhaser(jsCode);
}
export function parseNMEtoPhaser(jsCode) {
    const blocks = {};
    let hasAlphaOutput = false;  // set true when FragmentOutput.a is connected

    // ── 1. Extract block instantiations ──────────────────────────────────────
    const blockRegex = /var (\w+) = new BABYLON\.(\w+)Block\("(.*?)"\);/g;
    let match;
    while ((match = blockRegex.exec(jsCode)) !== null) {
        blocks[match[1]] = {
            varName: match[1],
            type: match[2],
            name: match[3],
            inputs: {},
            outputs: {},
            value: null,
            systemValue: null,
            glslType: null, // filled during codegen
            glslName: null,
        };
    }

    // ── 2. Extract .value assignments ─────────────────────────────────────────
    const vecValueRegex = /(\w+)\.value = new BABYLON\.(Color3|Color4|Vector2|Vector3|Vector4)\((.*?)\);/g;
    while ((match = vecValueRegex.exec(jsCode)) !== null) {
        if (blocks[match[1]]) blocks[match[1]].value = { type: match[2], data: match[3] };
    }

    const primitiveRegex = /(\w+)\.value = ([^;\n]+);/g;
    while ((match = primitiveRegex.exec(jsCode)) !== null) {
        if (blocks[match[1]] && !match[2].includes('BABYLON')) {
            blocks[match[1]].value = { type: 'Float', data: match[2].trim() };
        }
    }

    // ── 3. Extract system value flags ─────────────────────────────────────────
    const sysRegex = /(\w+)\.setAsSystemValue\(BABYLON\.NodeMaterialSystemValues\.(\w+)\);/g;
    while ((match = sysRegex.exec(jsCode)) !== null) {
        if (blocks[match[1]]) blocks[match[1]].systemValue = match[2];
    }

    // ── 4. Extract attribute assignments (uv, position, etc.) ─────────────────
    const attrRegex = /(\w+)\.setAsAttribute\("(\w+)"\);/g;
    while ((match = attrRegex.exec(jsCode)) !== null) {
        if (blocks[match[1]]) blocks[match[1]].attribute = match[2];
    }

    // ── 5. Build connection graph ──────────────────────────────────────────────
    const connectRegex = /(\w+)\.(\w+)\.connectTo\((\w+)\.(\w+)\);/g;
    while ((match = connectRegex.exec(jsCode)) !== null) {
        const [, srcVar, srcPort, dstVar, dstPort] = match;
        if (!blocks[srcVar]) {
            blocks[srcVar] = { varName: srcVar, type: 'Implicit', name: srcVar, inputs: {}, outputs: {}, value: null, systemValue: null };
        }
        if (!blocks[dstVar]) {
            blocks[dstVar] = { varName: dstVar, type: 'Implicit', name: dstVar, inputs: {}, outputs: {}, value: null, systemValue: null };
        }
        blocks[dstVar].inputs[dstPort] = { block: srcVar, port: srcPort };
        blocks[srcVar].outputs[srcPort] = { block: dstVar, port: dstPort };
    }

    // ── 6. Identify textures / samplers ───────────────────────────────────────
    // All ImageSource blocks become a single shared sampler named "noiseTex"
    const samplerMap = {}; // varName -> sampler uniform name
    let samplerCount = 0;

    for (const key in blocks) {
        const b = blocks[key];
        if (b.type === 'ImageSource' || b.type === 'Implicit' && key.toLowerCase().includes('image')) {
            const samplerName = samplerCount === 0 ? 'noiseTex' : `noiseTex${samplerCount}`;
            samplerMap[key] = samplerName;
            b.glslName = samplerName;
            samplerCount++;
        }
    }
    const samplers = Object.values(samplerMap);
    if (samplers.length === 0) samplers.push('noiseTex'); // fallback

    // ── 7. Collect uniforms ────────────────────────────────────────────────────
    const uniformDecls = []; // "uniform vec3 u_Foo;"
    const materialUniforms = []; // uniform names for ShaderMaterial setup

    for (const key in blocks) {
        const b = blocks[key];
        if (b.type !== 'Input' || b.systemValue !== null || b.attribute !== undefined) continue;
        if (!b.value) continue;
        if (b.name.toLowerCase().includes('time')) continue; // handled as built-in

        let glslType = 'float';
        if (b.value.type === 'Color3') glslType = 'vec3';
        else if (b.value.type === 'Color4') glslType = 'vec4';
        else if (b.value.type === 'Vector2') glslType = 'vec2';
        else if (b.value.type === 'Vector3' || b.value.type === 'Color3') glslType = 'vec3';
        else if (b.value.type === 'Vector4') glslType = 'vec4';

        // Use name if it's descriptive, else fallback to varName
        let baseName = b.varName;
        if (b.name && b.name.length > 1 && !/^(float|color|vector|input)/i.test(b.name)) {
            baseName = b.name.replace(/[^a-zA-Z0-9]/g, '_');
        }
        const uName = 'u_' + baseName;
        b.glslName = uName;
        b.glslType = glslType;
        uniformDecls.push(`uniform ${glslType} ${uName};`);
        materialUniforms.push(uName);
    }

    // ── 8. Block operation tables ──────────────────────────────────────────────
    //   These tables define GLSL code generation for every known NME block type.
    //   Unary:  one input  → one output     (input)
    //   Binary: two inputs → one output     (left, right)

    // input port for unary ops is always 'input'
    const UNARY_OPS = {
        'Negate':           x => `-(${x})`,
        'Abs':              x => `abs(${x})`,
        'Sign':             x => `sign(${x})`,
        'Floor':            x => `floor(${x})`,
        'Ceiling':          x => `ceil(${x})`,
        'Round':            x => `floor(${x} + 0.5)`,   // GLSL ES 1.0 has no round()
        'Fract':            x => `fract(${x})`,
        'Sqrt':             x => `sqrt(${x})`,
        'OneMinus':         x => `(1.0 - ${x})`,
        'Reciprocal':       x => `(1.0 / ${x})`,
        'Normalize':        x => `normalize(${x})`,
        'Length':            x => `length(${x})`,
        'Sin':              x => `sin(${x})`,
        'Cos':              x => `cos(${x})`,
        'Tan':              x => `tan(${x})`,
        'ArcSin':           x => `asin(${x})`,
        'ArcCos':           x => `acos(${x})`,
        'ArcTan':           x => `atan(${x})`,
        'Exp':              x => `exp(${x})`,
        'Exp2':             x => `exp2(${x})`,
        'Log':              x => `log(${x})`,
        'Saturate':         x => `clamp(${x}, 0.0, 1.0)`,
        'DegreesToRadians': x => `radians(${x})`,
        'RadiansToDegrees': x => `degrees(${x})`,
        'Desaturate':       x => `vec3(dot(${x}, vec3(0.299, 0.587, 0.114)))`,
    };

    // Unary ops whose output type differs from their input type
    const UNARY_RETURN_FLOAT = new Set(['Length']);

    // Inputs: left, right
    const BINARY_OPS = {
        'Add':              (l, r) => `${l} + ${r}`,
        'Subtract':         (l, r) => `${l} - ${r}`,
        'Multiply':         (l, r) => `${l} * ${r}`,
        'Divide':           (l, r) => `${l} / ${r}`,
        'Pow':              (l, r) => `pow(${l}, ${r})`,
        'Min':              (l, r) => `min(${l}, ${r})`,
        'Max':              (l, r) => `max(${l}, ${r})`,
        'Mod':              (l, r) => `mod(${l}, ${r})`,
        'Step':             (l, r) => `step(${l}, ${r})`,
        'Dot':              (l, r) => `dot(${l}, ${r})`,
        'Cross':            (l, r) => `cross(${l}, ${r})`,
        'Reflect':          (l, r) => `reflect(${l}, ${r})`,
        'Distance':         (l, r) => `distance(${l}, ${r})`,
        'ArcTan2':          (l, r) => `atan(${l}, ${r})`,
    };

    // Binary ops whose output type is always fixed
    const BINARY_RETURN_FLOAT = new Set(['Dot', 'Distance']);
    const BINARY_RETURN_VEC3  = new Set(['Cross']);

    // Wave generators (unary, input = 'input')
    const WAVE_OPS = {
        'SawToothWave':  x => `fract(${x})`,
        'SquareWave':    x => `step(0.5, fract(${x}))`,
        'TriangleWave':  x => `abs(2.0 * fract(${x}) - 1.0)`,
    };

    // Blocks that are vertex-only or system-level (skip silently)
    const SKIP_BLOCKS = new Set([
        'Transform', 'VertexOutput', 'Input', 'ImageSource', 'Implicit',
        'Instances', 'Bones', 'MorphTargets',
    ]);

    // ── 9. Type inference helper ───────────────────────────────────────────────
    const typeRank = { 'float': 0, 'vec2': 1, 'vec3': 2, 'vec4': 3 };
    function widerType(a, b) {
        return (typeRank[a] || 0) >= (typeRank[b] || 0) ? a : b;
    }

    function inferType(blockName, port) {
        const b = blocks[blockName];
        if (!b) return 'float';

        if (b.type === 'Input') {
            if (b.name === 'uv' || b.attribute === 'uv') return 'vec2';
            if (b.glslType) return b.glslType;
            if (b.value) {
                if (b.value.type === 'Color3') return 'vec3';
                if (b.value.type === 'Color4') return 'vec4';
                if (b.value.type === 'Vector2') return 'vec2';
                if (b.value.type === 'Vector3') return 'vec3';
                if (b.value.type === 'Float') return 'float';
            }
        }
        if (b.type === 'Panner') return 'vec2';
        if (b.type === 'Rotate2d') return 'vec2';
        if (b.type === 'Texture') {
            if (port === 'r' || port === 'g' || port === 'b' || port === 'a') return 'float';
            if (port === 'rgb') return 'vec3';
            return 'vec4';
        }
        if (b.type === 'VectorSplitter') {
            if (port === 'x' || port === 'y' || port === 'z' || port === 'w') return 'float';
            if (port === 'xyOut' || port === 'xy') return 'vec2';
            if (port === 'xyzOut' || port === 'xyz') return 'vec3';
        }
        if (b.type === 'VectorMerger' || b.type === 'ColorMerger') {
            if (port === 'xy' || port === 'xyOut') return 'vec2';
            if (port === 'xyz' || port === 'xyzOut' || port === 'rgb') return 'vec3';
            return 'vec4';
        }
        if (b.type === 'ColorSplitter') {
            if (port === 'r' || port === 'g' || port === 'b' || port === 'a') return 'float';
            if (port === 'rgb') return 'vec3';
        }
        // Unary ops
        if (UNARY_OPS[b.type] || WAVE_OPS[b.type]) {
            if (UNARY_RETURN_FLOAT.has(b.type)) return 'float';
            const inp = b.inputs.input || b.inputs.left;
            return inp ? inferType(inp.block, inp.port) : 'float';
        }
        if (b.type === 'VectorSplitter' || b.type === 'ColorSplitter') {
            const inp = b.inputs.xyIn || b.inputs.xyzIn || b.inputs.xyzwIn || b.inputs.rgbaIn || b.inputs.rgbIn ||
                        b.inputs.xy || b.inputs.xyz || b.inputs.xyzw || b.inputs.rgba || b.inputs.rgb;
            return inp ? inferType(inp.block, inp.port) : 'vec2';
        }
        // Binary ops
        if (BINARY_OPS[b.type]) {
            if (BINARY_RETURN_FLOAT.has(b.type)) return 'float';
            if (BINARY_RETURN_VEC3.has(b.type)) return 'vec3';
            const lt = b.inputs.left ? inferType(b.inputs.left.block, b.inputs.left.port) : 'float';
            const rt = b.inputs.right ? inferType(b.inputs.right.block, b.inputs.right.port) : 'float';
            return widerType(lt, rt);
        }
        if (b.type === 'Scale') {
            return b.inputs.input ? inferType(b.inputs.input.block, b.inputs.input.port) : 'float';
        }
        if (b.type === 'Lerp' || b.type === 'NLerp') {
            return b.inputs.left ? inferType(b.inputs.left.block, b.inputs.left.port) : 'float';
        }
        if (b.type === 'SmoothStep') {
            return b.inputs.value ? inferType(b.inputs.value.block, b.inputs.value.port) : 'float';
        }
        if (b.type === 'Clamp') {
            return b.inputs.value ? inferType(b.inputs.value.block, b.inputs.value.port) : 'float';
        }
        if (b.type === 'Remap') {
            return b.inputs.input ? inferType(b.inputs.input.block, b.inputs.input.port) : 'float';
        }
        if (b.type === 'Elbow') {
            return b.inputs.input ? inferType(b.inputs.input.block, b.inputs.input.port) : 'float';
        }
        if (b.type === 'Conditional') {
            return b.inputs.a ? inferType(b.inputs.a.block, b.inputs.a.port) : 'float';
        }
        if (b.type === 'Gradient') return 'vec3';
        if (b.type === 'Posterize') {
            return b.inputs.value ? inferType(b.inputs.value.block, b.inputs.value.port) : 'float';
        }
        if (b.type === 'Fresnel') return 'float';
        if (b.type === 'SimplexPerlin3D' || b.type === 'WorleyNoise3D') return 'float';
        if (b.type === 'VoronoiNoise') return port === 'cells' ? 'float' : 'float';
        if (b.type === 'RandomNumber') return 'float';
        if (b.type === 'Discard') return 'float';
        if (b.type === 'FrontFacing') return 'float';
        return 'float';
    }

    // ── 10. Code generation ───────────────────────────────────────────────────
    const computedBlocks = new Set();
    const glslStatements = [];
    const unsupportedBlocks = []; // track blocks we can't convert
    let needsNoiseFunc = false;   // will inject simplex noise GLSL if needed

    function resolveInput(blockName, port) {
        const b = blocks[blockName];
        if (!b) return '0.0';

        if (b.type === 'Input') {
            if (b.name.toLowerCase().includes('time') || b.name === 'DeltaTime' || b.name === 'RealTime') return 'time';
            if (b.name === 'uv' || b.attribute === 'uv') return 'vUV';
            if (b.attribute === 'normal') return 'vNormal';
            if (b.glslName) return b.glslName;
            return '0.0';
        }

        if (!computedBlocks.has(blockName)) computeBlock(blockName);

        const varName = `v_${blockName}`;
        // VectorSplitter / ColorSplitter
        if (b.type === 'VectorSplitter' || b.type === 'ColorSplitter') {
            if (port === 'x' || port === 'r') return `${varName}.x`;
            if (port === 'y' || port === 'g') return `${varName}.y`;
            if (port === 'z' || port === 'b') return `${varName}.z`;
            if (port === 'w' || port === 'a') return `${varName}.w`;
            if (port === 'xyOut' || port === 'xy' || port === 'rg') return `${varName}.xy`;
            if (port === 'xyzOut' || port === 'xyz' || port === 'rgb') return `${varName}.xyz`;
        }
        // VectorMerger / ColorMerger
        if (b.type === 'VectorMerger' || b.type === 'ColorMerger') {
            if (port === 'xy' || port === 'xyOut' || port === 'rg') return `${varName}.xy`;
            if (port === 'xyz' || port === 'xyzOut' || port === 'rgb') return `${varName}.xyz`;
            if (port === 'xyzw' || port === 'output' || port === 'rgba') return varName;
        }
        // Texture swizzles
        if (port === 'r' || port === 'g' || port === 'b' || port === 'a') return `${varName}.${port}`;
        if (port === 'rgb') return `${varName}.rgb`;
        if (port === 'rg' || port === 'xy') return `${varName}.xy`;
        return varName;
    }

    function computeBlock(blockName) {
        if (computedBlocks.has(blockName)) return;
        const b = blocks[blockName];
        if (!b) return;
        if (SKIP_BLOCKS.has(b.type)) { computedBlocks.add(blockName); return; }

        // Ensure all input blocks are computed first
        for (const port in b.inputs) computeBlock(b.inputs[port].block);

        const varName = `v_${blockName}`;
        let outType = 'float';
        let code = '';

        // ── Unary math ops ────────────────────────────────────────────
        if (UNARY_OPS[b.type]) {
            const inp = resolveInput(
                b.inputs.input?.block || b.inputs.left?.block,
                b.inputs.input?.port  || b.inputs.left?.port
            ) || '0.0';
            outType = UNARY_RETURN_FLOAT.has(b.type) ? 'float'
                    : inferType(b.inputs.input?.block || b.inputs.left?.block,
                                b.inputs.input?.port  || b.inputs.left?.port);
            code = UNARY_OPS[b.type](inp);
            glslStatements.push(`    ${outType} ${varName} = ${code};`);
            computedBlocks.add(blockName); return;
        }
        // ── Wave generators ───────────────────────────────────────────
        if (WAVE_OPS[b.type]) {
            const inp = resolveInput(b.inputs.input?.block, b.inputs.input?.port) || '0.0';
            outType = inferType(b.inputs.input?.block, b.inputs.input?.port);
            code = WAVE_OPS[b.type](inp);
            glslStatements.push(`    ${outType} ${varName} = ${code};`);
            computedBlocks.add(blockName); return;
        }
        // ── Binary math ops ───────────────────────────────────────────
        if (BINARY_OPS[b.type]) {
            const l = resolveInput(b.inputs.left?.block, b.inputs.left?.port) || '0.0';
            const r = resolveInput(b.inputs.right?.block, b.inputs.right?.port) || '0.0';
            if (BINARY_RETURN_FLOAT.has(b.type)) outType = 'float';
            else if (BINARY_RETURN_VEC3.has(b.type)) outType = 'vec3';
            else outType = inferType(blockName, null);
            code = BINARY_OPS[b.type](l, r);
            glslStatements.push(`    ${outType} ${varName} = ${code};`);
            computedBlocks.add(blockName); return;
        }

        // ── Special blocks ────────────────────────────────────────────
        switch (b.type) {
            case 'Panner': {
                outType = 'vec2';
                const pUV = resolveInput(b.inputs.uv?.block, b.inputs.uv?.port) || 'vUV';
                const spd = b.inputs.speed ? resolveInput(b.inputs.speed.block, b.inputs.speed.port) : 'vec2(0.0)';
                const pt = b.inputs.time ? resolveInput(b.inputs.time.block, b.inputs.time.port) : 'time';
                code = `fract(${pUV} + ${spd} * ${pt})`;
                break;
            }
            case 'Texture': {
                outType = 'vec4';
                const tUV = b.inputs.uv ? resolveInput(b.inputs.uv.block, b.inputs.uv.port) : 'vUV';
                let samp = samplers[0];
                if (b.inputs.source) {
                    const srcBlock = blocks[b.inputs.source.block];
                    if (srcBlock?.glslName) samp = srcBlock.glslName;
                }
                code = `texture2D(${samp}, ${tUV})`;
                break;
            }
            case 'Lerp': case 'NLerp': {
                const ll = resolveInput(b.inputs.left?.block, b.inputs.left?.port) || '0.0';
                const lr = resolveInput(b.inputs.right?.block, b.inputs.right?.port) || '0.0';
                const lg = resolveInput(b.inputs.gradient?.block, b.inputs.gradient?.port) || '0.0';
                outType = inferType(b.inputs.left?.block, b.inputs.left?.port);
                code = `mix(${ll}, ${lr}, ${lg})`;
                if (b.type === 'NLerp') code = `normalize(${code})`;
                break;
            }
            case 'Scale': {
                const sv = resolveInput(b.inputs.input?.block, b.inputs.input?.port) || '0.0';
                const sf = resolveInput(b.inputs.factor?.block, b.inputs.factor?.port) || '1.0';
                outType = inferType(b.inputs.input?.block, b.inputs.input?.port);
                code = `${sv} * ${sf}`;
                break;
            }
            case 'Clamp': {
                const cv = resolveInput(b.inputs.value?.block, b.inputs.value?.port) || '0.0';
                const cmin = resolveInput(b.inputs.minimum?.block, b.inputs.minimum?.port) || '0.0';
                const cmax = resolveInput(b.inputs.maximum?.block, b.inputs.maximum?.port) || '1.0';
                outType = inferType(b.inputs.value?.block, b.inputs.value?.port);
                code = `clamp(${cv}, ${cmin}, ${cmax})`;
                break;
            }
            case 'SmoothStep': {
                const ssv = resolveInput(b.inputs.value?.block, b.inputs.value?.port) || '0.0';
                const sse0 = resolveInput(b.inputs.edge0?.block, b.inputs.edge0?.port) || '0.0';
                const sse1 = resolveInput(b.inputs.edge1?.block, b.inputs.edge1?.port) || '1.0';
                outType = inferType(b.inputs.value?.block, b.inputs.value?.port);
                code = `smoothstep(${sse0}, ${sse1}, ${ssv})`;
                break;
            }
            case 'Remap': {
                const rv = resolveInput(b.inputs.input?.block, b.inputs.input?.port) || '0.0';
                const rsMin = resolveInput(b.inputs.sourceRange?.block, b.inputs.sourceRange?.port) || 'vec2(0.0, 1.0)';
                const rtMin = resolveInput(b.inputs.targetRange?.block, b.inputs.targetRange?.port) || 'vec2(0.0, 1.0)';
                outType = inferType(b.inputs.input?.block, b.inputs.input?.port);
                code = `(${rv} - ${rsMin}.x) / (${rsMin}.y - ${rsMin}.x) * (${rtMin}.y - ${rtMin}.x) + ${rtMin}.x`;
                break;
            }
            case 'Rotate2d': {
                outType = 'vec2';
                const rinp = resolveInput(b.inputs.input?.block, b.inputs.input?.port) || 'vUV';
                const rang = resolveInput(b.inputs.angle?.block, b.inputs.angle?.port) || '0.0';
                code = `vec2(cos(${rang}) * ${rinp}.x - sin(${rang}) * ${rinp}.y, sin(${rang}) * ${rinp}.x + cos(${rang}) * ${rinp}.y)`;
                break;
            }
            case 'Posterize': {
                const pv = resolveInput(b.inputs.value?.block, b.inputs.value?.port) || '0.0';
                const ps = resolveInput(b.inputs.steps?.block, b.inputs.steps?.port) || '4.0';
                outType = inferType(b.inputs.value?.block, b.inputs.value?.port);
                code = `floor(${pv} * ${ps}) / ${ps}`;
                break;
            }
            case 'ReplaceColor': {
                const rcRef = resolveInput(b.inputs.value?.block, b.inputs.value?.port) || 'vec3(0.0)';
                const rcOld = resolveInput(b.inputs.reference?.block, b.inputs.reference?.port) || 'vec3(0.0)';
                const rcNew = resolveInput(b.inputs.replacement?.block, b.inputs.replacement?.port) || 'vec3(1.0)';
                const rcDist = resolveInput(b.inputs.distance?.block, b.inputs.distance?.port) || '0.1';
                outType = 'vec3';
                code = `mix(${rcNew}, ${rcRef}, step(${rcDist}, distance(${rcRef}, ${rcOld})))`;
                break;
            }
            case 'Gradient': {
                outType = 'vec3';
                const gGrad = resolveInput(b.inputs.gradient?.block, b.inputs.gradient?.port) || '0.0';
                // Simple 2-stop gradient: black to white, user can tweak via uniforms
                code = `vec3(${gGrad})`;
                break;
            }
            case 'Conditional': {
                const ca = resolveInput(b.inputs.a?.block, b.inputs.a?.port) || '0.0';
                const cb = resolveInput(b.inputs.b?.block, b.inputs.b?.port) || '0.0';
                const cTrue = resolveInput(b.inputs.true?.block, b.inputs.true?.port) || '1.0';
                const cFalse = resolveInput(b.inputs.false?.block, b.inputs.false?.port) || '0.0';
                outType = inferType(b.inputs.true?.block, b.inputs.true?.port) || 'float';
                // Default op: greaterThan
                code = `mix(${cFalse}, ${cTrue}, step(${cb}, ${ca}))`;
                break;
            }
            case 'Fresnel': {
                outType = 'float';
                const fBias = resolveInput(b.inputs.bias?.block, b.inputs.bias?.port) || '0.0';
                const fPow = resolveInput(b.inputs.power?.block, b.inputs.power?.port) || '1.0';
                code = `clamp(${fBias} + pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), ${fPow}), 0.0, 1.0)`;
                break;
            }
            case 'RandomNumber': {
                outType = 'float';
                const rSeed = resolveInput(b.inputs.seed?.block, b.inputs.seed?.port) || 'vUV';
                code = `fract(sin(dot(${rSeed}, vec2(12.9898, 78.233))) * 43758.5453)`;
                break;
            }
            case 'SimplexPerlin3D': {
                outType = 'float';
                needsNoiseFunc = true;
                const np = resolveInput(b.inputs.seed?.block, b.inputs.seed?.port) || 'vec3(vUV, time)';
                code = `snoise(${np})`;
                break;
            }
            case 'VoronoiNoise': {
                outType = 'float';
                const vn = resolveInput(b.inputs.seed?.block, b.inputs.seed?.port) || 'vUV';
                const voff = resolveInput(b.inputs.offset?.block, b.inputs.offset?.port) || '0.0';
                const vden = resolveInput(b.inputs.density?.block, b.inputs.density?.port) || '5.0';
                code = `fract(sin(dot(floor(${vn} * ${vden} + ${voff}), vec2(127.1, 311.7))) * 43758.5453)`;
                break;
            }
            case 'Discard': {
                const dv = resolveInput(b.inputs.value?.block, b.inputs.value?.port) || '0.0';
                const dc = resolveInput(b.inputs.cutoff?.block, b.inputs.cutoff?.port) || '0.5';
                glslStatements.push(`    if (${dv} < ${dc}) discard;`);
                computedBlocks.add(blockName); return;
            }
            case 'FrontFacing': {
                outType = 'float';
                code = `(gl_FrontFacing ? 1.0 : 0.0)`;
                break;
            }
            case 'VectorSplitter': case 'ColorSplitter': {
                // Pass through — resolveInput handles swizzle ports
                const input = resolveInput(
                    b.inputs.xyIn?.block || b.inputs.xyzIn?.block || b.inputs.xyzwIn?.block || b.inputs.rgbaIn?.block || b.inputs.rgbIn?.block ||
                    b.inputs.xy?.block || b.inputs.xyz?.block || b.inputs.xyzw?.block || b.inputs.rgba?.block || b.inputs.rgb?.block,
                    b.inputs.xyIn?.port  || b.inputs.xyzIn?.port  || b.inputs.xyzwIn?.port  || b.inputs.rgbaIn?.port  || b.inputs.rgbIn?.port ||
                    b.inputs.xy?.port || b.inputs.xyz?.port || b.inputs.xyzw?.port || b.inputs.rgba?.port || b.inputs.rgb?.port
                ) || 'vec2(0.0)';
                if (b.inputs.xyzwIn || b.inputs.rgbaIn || b.inputs.xyzw || b.inputs.rgba) outType = 'vec4';
                else if (b.inputs.xyzIn || b.inputs.rgbIn || b.inputs.xyz || b.inputs.rgb) outType = 'vec3';
                else outType = 'vec2';
                code = input;
                break;
            }
            case 'VectorMerger': case 'ColorMerger': {
                const mmx = b.inputs.x?.block || b.inputs.r?.block;
                const mmy = b.inputs.y?.block || b.inputs.g?.block;
                const mmz = b.inputs.z?.block || b.inputs.b?.block;
                const mmw = b.inputs.w?.block || b.inputs.a?.block;
                const mx = mmx ? resolveInput(mmx, b.inputs.x?.port || b.inputs.r?.port) : '0.0';
                const my = mmy ? resolveInput(mmy, b.inputs.y?.port || b.inputs.g?.port) : '0.0';
                const mz = mmz ? resolveInput(mmz, b.inputs.z?.port || b.inputs.b?.port) : null;
                const mw = mmw ? resolveInput(mmw, b.inputs.w?.port || b.inputs.a?.port) : null;
                if (mw !== null) { outType = 'vec4'; code = `vec4(${mx}, ${my}, ${mz || '0.0'}, ${mw})`; }
                else if (mz !== null) { outType = 'vec3'; code = `vec3(${mx}, ${my}, ${mz})`; }
                else { outType = 'vec2'; code = `vec2(${mx}, ${my})`; }
                break;
            }
            case 'Elbow': {
                const ei = resolveInput(b.inputs.input?.block, b.inputs.input?.port);
                outType = inferType(b.inputs.input?.block, b.inputs.input?.port) || 'vec3';
                code = ei;
                break;
            }
            case 'FragmentOutput': {
                const rgb = resolveInput(b.inputs.rgb?.block, b.inputs.rgb?.port) || 'vec3(0.0)';
                const rgbType = inferType(b.inputs.rgb?.block, b.inputs.rgb?.port);
                const rgbExpr = rgbType === 'vec3' ? rgb : `vec3(${rgb})`;

                if (b.inputs.a) {
                    const alphaSrc = resolveInput(b.inputs.a.block, b.inputs.a.port);
                    glslStatements.push(`    float alphaVal = clamp(${alphaSrc}, 0.0, 1.0);`);
                    glslStatements.push(`    gl_FragColor = vec4(${rgbExpr}, alphaVal);`);
                    hasAlphaOutput = true;
                } else {
                    glslStatements.push(`    gl_FragColor = vec4(${rgbExpr}, 1.0);`);
                }
                computedBlocks.add(blockName);
                return;
            }
            default: {
                // Unknown block — track it for warning
                if (!unsupportedBlocks.includes(b.type)) unsupportedBlocks.push(b.type);
                // Best-effort passthrough: try the first connected input
                const firstInput = Object.values(b.inputs)[0];
                if (firstInput) {
                    code = resolveInput(firstInput.block, firstInput.port);
                    outType = inferType(firstInput.block, firstInput.port);
                } else {
                    code = '0.0';
                }
                break;
            }
        }

        glslStatements.push(`    ${outType} ${varName} = ${code};`);
        computedBlocks.add(blockName);
    }

    const fragOutBlock = Object.keys(blocks).find(k => blocks[k].type === 'FragmentOutput');
    if (!fragOutBlock) {
        throw new Error('No FragmentOutput block found in the NME export. This shader cannot be converted.');
    }
    computeBlock(fragOutBlock);

    // ── 11. Assemble fragment GLSL ─────────────────────────────────────────────
    let glsl = '// Auto-converted from Babylon NME export\n';
    glsl += 'precision mediump float;\n\n';
    glsl += '// Built-ins\n';
    glsl += 'uniform float time;\n';
    glsl += 'uniform vec2 resolution;\n\n';

    // Inject simplex noise function if needed
    if (needsNoiseFunc) {
        glsl += '// Simplex noise (3D)\n';
        glsl += 'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}\n';
        glsl += 'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}\n';
        glsl += 'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}\n';
        glsl += 'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}\n';
        glsl += 'float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);\n';
        glsl += 'vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);\n';
        glsl += 'vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);\n';
        glsl += 'vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;\n';
        glsl += 'i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));\n';
        glsl += 'float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;\n';
        glsl += 'vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);\n';
        glsl += 'vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);\n';
        glsl += 'vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);\n';
        glsl += 'vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));\n';
        glsl += 'vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;\n';
        glsl += 'vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);\n';
        glsl += 'vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));\n';
        glsl += 'p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;\n';
        glsl += 'vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);\n';
        glsl += 'm=m*m;return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}\n\n';
    }

    glsl += '// Texture samplers\n';
    samplers.forEach(s => { glsl += `uniform sampler2D ${s};\n`; });
    if (uniformDecls.length > 0) {
        glsl += '\n// Custom uniforms\n';
        uniformDecls.forEach(u => { glsl += u + '\n'; });
    }
    glsl += '\n// From vertex shader\n';
    glsl += 'varying vec2 vUV;\n';
    glsl += 'varying vec3 vNormal;\n\n';
    glsl += 'void main(void) {\n';
    glsl += glslStatements.join('\n');
    glsl += '\n}\n';

    // ── 12. Build material config ──────────────────────────────────────────────
    const defaultValues = {};
    for (const key in blocks) {
        const b = blocks[key];
        if (!b.glslName || b.type !== 'Input') continue;
        if (!b.value) continue;
        if (b.value.type === 'Color3' || b.value.type === 'Vector3') {
            const [r, g, bv] = b.value.data.split(',').map(Number);
            defaultValues[b.glslName] = { type: b.value.type, r, g, b: bv };
        } else if (b.value.type === 'Vector2') {
            const [x, y] = b.value.data.split(',').map(Number);
            defaultValues[b.glslName] = { type: 'Vector2', x, y };
        } else if (b.value.type === 'Float') {
            defaultValues[b.glslName] = { type: 'Float', val: Number(b.value.data) };
        }
    }

    // Build warnings list
    const warnings = [];
    if (unsupportedBlocks.length > 0) {
        warnings.push(`Unsupported block types (passthrough used): ${unsupportedBlocks.join(', ')}`);
    }

    return { glsl, uniforms: materialUniforms, samplers, defaultValues, hasAlpha: hasAlphaOutput, warnings };

}

// ═══════════════════════════════════════════════════════════════════════════════
//  Compiled NME GLSL Parser
//  Parses the raw vertex + fragment GLSL that NME compiles, resolves
//  preprocessor directives, remaps Babylon uniforms, and produces a config
//  compatible with ShaderMaterial.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve #ifdef / #ifndef / #if defined() / #elif / #else / #endif blocks.
 * Lines guarded by inactive macros are removed. #include lines are stripped.
 */
function resolvePreprocessor(code, defines) {
    const lines = code.split('\n');
    const result = [];
    // Stack entries: { active, anyBranchTaken, parentActive }
    const stack = [];

    const isActive = () => stack.length === 0 || stack[stack.length - 1].active;
    const parentActive = () => stack.length === 0 || stack[stack.length - 1].active;

    for (const line of lines) {
        const t = line.trim();

        // ── #ifdef MACRO ────────────────────────────────────────────
        if (t.startsWith('#ifdef ')) {
            const macro = t.slice(7).trim();
            const pa = isActive();
            const act = defines.has(macro) && pa;
            stack.push({ active: act, anyBranchTaken: act, parentActive: pa });
            continue;
        }
        // ── #ifndef MACRO ───────────────────────────────────────────
        if (t.startsWith('#ifndef ')) {
            const macro = t.slice(8).trim();
            const pa = isActive();
            const act = !defines.has(macro) && pa;
            stack.push({ active: act, anyBranchTaken: act, parentActive: pa });
            continue;
        }
        // ── #if defined(X) || defined(Y) ... ────────────────────────
        if (t.startsWith('#if ')) {
            const expr = t.slice(4);
            const checks = [...expr.matchAll(/defined\((\w+)\)/g)].map(m => m[1]);
            const pa = isActive();
            let act;
            if (expr.includes('||')) {
                act = checks.some(m => defines.has(m));
            } else {
                act = checks.every(m => defines.has(m));
            }
            act = act && pa;
            stack.push({ active: act, anyBranchTaken: act, parentActive: pa });
            continue;
        }
        // ── #elif defined(MACRO) ────────────────────────────────────
        if (t.startsWith('#elif')) {
            const top = stack[stack.length - 1];
            if (top.anyBranchTaken) {
                top.active = false;
            } else {
                const check = t.match(/defined\((\w+)\)/);
                const act = check ? defines.has(check[1]) && top.parentActive : false;
                top.active = act;
                top.anyBranchTaken = top.anyBranchTaken || act;
            }
            continue;
        }
        // ── #else ───────────────────────────────────────────────────
        if (t === '#else') {
            const top = stack[stack.length - 1];
            top.active = !top.anyBranchTaken && top.parentActive;
            continue;
        }
        // ── #endif ──────────────────────────────────────────────────
        if (t === '#endif') {
            stack.pop();
            continue;
        }
        // ── #include — strip ────────────────────────────────────────
        if (t.startsWith('#include')) { continue; }
        // ── #extension / layout — strip ─────────────────────────────
        if (t.startsWith('#extension') || t.startsWith('layout(')) { continue; }
        // ── Normal line ─────────────────────────────────────────────
        if (isActive()) {
            result.push(line);
        }
    }
    return result.join('\n');
}

/**
 * Babylon helper functions that NME shaders may reference via #include<helperFunctions>.
 * We inline them into the fragment shader so they're always available.
 */
const HELPER_FUNCTIONS = `
// Inlined Babylon helperFunctions
vec3 toLinearSpace(vec3 c) { return pow(c, vec3(2.2)); }
vec4 toLinearSpace(vec4 c) { return vec4(pow(c.rgb, vec3(2.2)), c.a); }
vec3 toGammaSpace(vec3 c)  { return pow(c, vec3(1.0/2.2)); }
vec4 toGammaSpace(vec4 c)  { return vec4(pow(c.rgb, vec3(1.0/2.2)), c.a); }
`;

/** Uniforms automatically provided by Babylon / our engine — skip for GUI */
const BUILTIN_UNIFORMS = new Set([
    'world', 'view', 'projection', 'viewProjection',
    'worldView', 'worldViewProjection',
    'u_World', 'u_ViewProjection',
    'time', 'u_Time', 'resolution',
    'textureTransform',
]);

/** Known Babylon internal uniforms with sensible defaults */
const KNOWN_DEFAULTS = {
    textureInfoName: { type: 'Float', val: 1.0 },
    useAdditionalColor: { type: 'Float', val: 0.0 },
};

/** Remap Babylon uniform names to our ShaderMaterial conventions */
const UNIFORM_REMAP = {
    'u_World': 'world',
    'u_ViewProjection': 'viewProjection',
    'u_Time': 'time',
};

/**
 * Parse compiled NME GLSL (the raw vertex + fragment shader text from NME).
 * Returns a matConfig compatible with applyShader().
 */
export function parseCompiledNME(text) {
    // ── 1. Split vertex / fragment shaders ─────────────────────────────────────
    const fragIdx = text.indexOf('// Fragment shader');
    if (fragIdx === -1) {
        throw new Error('Could not find "// Fragment shader" delimiter in the compiled GLSL.');
    }
    let vertexRaw = text.slice(0, fragIdx).trim();
    let fragmentRaw = text.slice(fragIdx).trim();

    // Strip the comment headers
    vertexRaw = vertexRaw.replace(/^\/\/\s*Vertex shader\s*\n?/, '');
    fragmentRaw = fragmentRaw.replace(/^\/\/\s*Fragment shader\s*\n?/, '');

    // ── 2. Resolve preprocessor (defines active for standard WebGL1 use) ──────
    const defines = new Set(['UV1', 'VMAINXY']);
    let vertexClean = resolvePreprocessor(vertexRaw, defines);
    let fragmentClean = resolvePreprocessor(fragmentRaw, defines);

    // ── 3. Remap uniform names ─────────────────────────────────────────────────
    for (const [from, to] of Object.entries(UNIFORM_REMAP)) {
        const re = new RegExp(`\\b${from}\\b`, 'g');
        vertexClean = vertexClean.replace(re, to);
        fragmentClean = fragmentClean.replace(re, to);
    }

    // ── 4. Inject helper functions into fragment shader ────────────────────────
    // Insert after the last uniform/varying declaration
    const precisionMatch = fragmentClean.match(/precision\s+\w+\s+float\s*;/);
    if (precisionMatch) {
        const insertPos = fragmentClean.indexOf(precisionMatch[0]) + precisionMatch[0].length;
        fragmentClean = fragmentClean.slice(0, insertPos) + '\n' + HELPER_FUNCTIONS + fragmentClean.slice(insertPos);
    }

    // ── 5. Clean up stray blank lines and highp redeclarations ─────────────────
    // Remove duplicate precision declarations
    vertexClean = vertexClean.replace(/precision\s+highp\s+sampler2DArray\s*;\s*\n?/g, '');
    fragmentClean = fragmentClean.replace(/precision\s+highp\s+sampler2DArray\s*;\s*\n?/g, '');
    // Remove "highp vec4 gl_FragColor;" redeclaration (from PREPASS path)
    fragmentClean = fragmentClean.replace(/highp\s+vec4\s+gl_FragColor\s*;\s*\n?/g, '');

    // Collapse multiple blank lines
    vertexClean = vertexClean.replace(/\n{3,}/g, '\n\n');
    fragmentClean = fragmentClean.replace(/\n{3,}/g, '\n\n');

    // ── 6. Extract samplers ────────────────────────────────────────────────────
    const samplers = [];
    const samplerRe = /uniform\s+sampler2D\s+(\w+)\s*;/g;
    let sm;
    while ((sm = samplerRe.exec(fragmentClean)) !== null) {
        if (!samplers.includes(sm[1])) samplers.push(sm[1]);
    }

    // ── 7. Extract custom uniforms for GUI ─────────────────────────────────────
    const customUniforms = [];
    const defaultValues = {};
    const uniformRe = /uniform\s+(\w+)\s+(\w+)\s*;/g;
    // Scan both shaders but deduplicate
    const allGLSL = vertexClean + '\n' + fragmentClean;
    const seen = new Set();
    let um;
    while ((um = uniformRe.exec(allGLSL)) !== null) {
        const [, type, name] = um;
        if (seen.has(name)) continue;
        seen.add(name);
        if (BUILTIN_UNIFORMS.has(name)) continue;
        if (type === 'sampler2D') continue;
        if (type === 'mat4') continue; // not GUI-controllable

        customUniforms.push(name);

        // Assign default values
        if (KNOWN_DEFAULTS[name]) {
            defaultValues[name] = KNOWN_DEFAULTS[name];
        } else if (type === 'float') {
            defaultValues[name] = { type: 'Float', val: 0.0 };
        } else if (type === 'vec2') {
            defaultValues[name] = { type: 'Vector2', x: 0, y: 0 };
        } else if (type === 'vec3') {
            defaultValues[name] = { type: 'Vector3', r: 1, g: 1, b: 1 };
        }
    }

    // ── 8. Detect alpha output ─────────────────────────────────────────────────
    // Check if fragment shader writes alpha that isn't 1.0
    const hasAlpha = /gl_FragColor\s*=\s*vec4\s*\([^)]+,\s*a\s*\)/.test(fragmentClean)
                  || /gl_FragColor\s*=\s*vec4\s*\([^)]+,\s*alphaVal\s*\)/.test(fragmentClean);

    // ── 9. Return config ──────────────────────────────────────────────────────
    return {
        glsl: fragmentClean,
        vertexShader: vertexClean,
        uniforms: customUniforms,
        samplers,
        defaultValues,
        hasAlpha,
    };
}
