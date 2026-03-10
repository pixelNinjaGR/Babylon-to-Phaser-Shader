import './style.css';
import {
    Engine, Scene, ArcRotateCamera, HemisphericLight, Vector3, Vector2, Color3, Color4,
    MeshBuilder, ShaderMaterial, Texture, SceneLoader, Mesh
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '@babylonjs/loaders/OBJ';
import GUI from 'lil-gui';
import { parseNMEtoPhaser, parseCompiledNME, parseNMEJSON } from './shaderConverter.js';

// ===================== TOAST NOTIFICATIONS =====================

let toastContainer = null;
function showToast(message, type = 'info', duration = 3500) {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
            position:fixed; top:16px; right:16px; z-index:10000;
            display:flex; flex-direction:column; gap:8px;
            pointer-events:none; max-width:420px;
        `;
        document.body.appendChild(toastContainer);
    }
    const colors = {
        success: { bg: 'rgba(16,185,129,0.92)', border: '#10b981' },
        warning: { bg: 'rgba(245,158,11,0.92)', border: '#f59e0b' },
        error:   { bg: 'rgba(239,68,68,0.92)',   border: '#ef4444' },
        info:    { bg: 'rgba(99,102,241,0.92)',   border: '#6366f1' },
    };
    const c = colors[type] || colors.info;
    const el = document.createElement('div');
    el.style.cssText = `
        background:${c.bg}; border:1px solid ${c.border};
        color:#fff; padding:10px 16px; border-radius:8px;
        font:13px/1.5 'Inter',sans-serif; pointer-events:auto;
        box-shadow:0 4px 16px rgba(0,0,0,0.3); backdrop-filter:blur(8px);
        opacity:0; transform:translateX(24px);
        transition: opacity .3s, transform .3s;
    `;
    el.textContent = message;
    toastContainer.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateX(24px)';
        setTimeout(() => el.remove(), 350);
    }, duration);
}

// ===================== SHADERS =====================

const vertexShader = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec3 normal;

uniform mat4 worldViewProjection;
uniform mat4 world;

varying vec2 vUV;
varying vec3 vNormal;

void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vUV = uv;
    vNormal = normalize((world * vec4(normal, 0.0)).xyz);
}
`;

const fragmentShader = `
precision mediump float;

uniform float time;
uniform sampler2D noiseTex;
uniform vec3 u_Color;
uniform vec3 u_Color1;
uniform vec2 u_Speed_Noise;
uniform vec2 u_Distortion;
uniform vec2 u_Speed;
uniform vec3 u_BgColor;

varying vec2 vUV;
varying vec3 vNormal;

void main() {
    vec2 uv = vUV;

    // Panner 1: scroll noise UV
    vec2 noiseUV = fract(uv + u_Speed_Noise * time);

    // Green channel for color mixing
    float g_noise = texture2D(noiseTex, noiseUV).g;

    // Distortion
    vec2 distortion = u_Distortion * g_noise;
    vec2 distortedUV = uv + distortion;

    // Panner 2: scroll distorted UV
    vec2 finalUV = fract(distortedUV + u_Speed * time);

    // Alpha mask from Red channel
    float alphaMask = texture2D(noiseTex, finalUV).r;

    // Mix the two colors using green noise
    vec3 mixedColor = mix(u_Color, u_Color1, g_noise);

    // Manual alpha blend with background color
    vec3 finalColor = mix(u_BgColor, mixedColor, alphaMask);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ===================== ENGINE SETUP =====================

const canvas = document.getElementById('renderCanvas');
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.102, 0.102, 0.180, 1.0);

// Camera
const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.5, 5, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.wheelPrecision = 50;
camera.minZ = 0.01;
camera.lowerRadiusLimit = 1;
camera.upperRadiusLimit = 50;

// Light
const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
light.intensity = 0.8;

// ===================== SCENE GRID =====================

let gridLines = [];
let gridVisible = true;

function createGrid(size, divisions, color) {
    disposeGrid();
    const c = color || new Color3(0.2, 0.2, 0.3);
    const step = size / divisions;
    const half = size / 2;
    for (let i = 0; i <= divisions; i++) {
        const pos = -half + i * step;
        // X-axis line
        const lx = MeshBuilder.CreateLines('gx' + i, {
            points: [new Vector3(pos, 0, -half), new Vector3(pos, 0, half)]
        }, scene);
        lx.color = c;
        lx.isPickable = false;
        gridLines.push(lx);
        // Z-axis line
        const lz = MeshBuilder.CreateLines('gz' + i, {
            points: [new Vector3(-half, 0, pos), new Vector3(half, 0, pos)]
        }, scene);
        lz.color = c;
        lz.isPickable = false;
        gridLines.push(lz);
    }
}

function disposeGrid() {
    gridLines.forEach(l => l.dispose());
    gridLines = [];
}

function toggleGrid(show) {
    gridVisible = show;
    if (show && gridLines.length === 0) {
        createGrid(12, 20, new Color3(
            activeBgColor.r + 0.08,
            activeBgColor.g + 0.08,
            activeBgColor.b + 0.08
        ));
    }
    gridLines.forEach(l => l.setEnabled(show));
}

// Build default grid
createGrid(12, 20);

// ===================== SHADER MATERIAL & MESH STATE =====================

let shaderMat;
let activeSamplers = [];
let currentMeshes = []; // Track all meshes in the scene

// Scene background colour — drives u_BgColor so alpha compositing matches
const BG_DEFAULT = { r: 0.102, g: 0.102, b: 0.180 }; // #1a1a2e
let activeBgColor = { ...BG_DEFAULT };

let lastConvertedGLSL = null;   // filled after NME conversion only
let lastConvertedName = 'shader'; // base filename for download

function applyShader(matConfig) {
    if (shaderMat) {
        shaderMat.dispose();
    }

    // If the config provides its own vertex shader (compiled NME), use it
    // and register separate world + viewProjection uniforms.
    // Otherwise use our built-in vertex shader with worldViewProjection.
    const useCustomVertex = !!matConfig.vertexShader;
    const vtxSrc = useCustomVertex ? matConfig.vertexShader : vertexShader;
    const baseUniforms = useCustomVertex
        ? ['world', 'viewProjection', 'time', 'resolution']
        : ['worldViewProjection', 'world', 'time', 'resolution'];

    const allUniforms = [...new Set([...baseUniforms, ...matConfig.uniforms])];

    shaderMat = new ShaderMaterial('babylonShader', scene, {
        vertexSource: vtxSrc,
        fragmentSource: matConfig.glsl
    }, {
        attributes: ['position', 'uv', 'normal'],
        uniforms: allUniforms,
        samplers: matConfig.samplers,
        needAlphaBlending: !!matConfig.hasAlpha
    });

    activeSamplers = matConfig.samplers || [];

    // Only bind the default noise texture when the shader actually uses samplers.
    if (activeSamplers.length > 0) {
        const noiseTex = new Texture('noise_texture.png', scene);
        noiseTex.wrapU = Texture.WRAP_ADDRESSMODE;
        noiseTex.wrapV = Texture.WRAP_ADDRESSMODE;
        activeSamplers.forEach(s => {
            shaderMat.setTexture(s, noiseTex);
        });
        const texRow = document.getElementById('textureRow');
        if (texRow) texRow.style.opacity = '1';
    } else {
        const texRow = document.getElementById('textureRow');
        if (texRow) texRow.style.opacity = '0.35';
    }

    shaderMat.backFaceCulling = false;

    if (matConfig.hasAlpha) {
        shaderMat.alphaMode = 2; // ALPHA_COMBINE
    } else {
        shaderMat.alphaMode = 0; // ALPHA_DISABLE
    }

    buildGUI(matConfig);
    applyMaterialToMeshes(currentMeshes);
}


// Start with default plane mesh
createPrimitive('plane');


function clearCurrentMeshes() {
    currentMeshes.forEach(m => m.dispose());
    currentMeshes = [];
}

function applyMaterialToMeshes(meshes) {
    meshes.forEach(mesh => {
        if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
            mesh.material = shaderMat;
        }
    });
}

function fitMeshesToView(meshes) {
    // Get combined bounding info
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);

    meshes.forEach(mesh => {
        if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
            mesh.computeWorldMatrix(true);
            const bounds = mesh.getBoundingInfo().boundingBox;
            min = Vector3.Minimize(min, bounds.minimumWorld);
            max = Vector3.Maximize(max, bounds.maximumWorld);
        }
    });

    const center = min.add(max).scale(0.5);
    const size = max.subtract(min);
    const maxDim = Math.max(size.x, size.y, size.z);

    if (maxDim > 0) {
        const scale = 3.0 / maxDim;
        meshes.forEach(mesh => {
            mesh.position = mesh.position.subtract(center).scale(scale);
            mesh.scaling = mesh.scaling.scale(scale);
        });

        camera.setTarget(Vector3.Zero());
        camera.radius = 5;
    }
}

function createPrimitive(type) {
    clearCurrentMeshes();

    let mesh;
    switch (type) {
        case 'plane':
            mesh = MeshBuilder.CreatePlane('plane', { size: 3, sideOrientation: Mesh.DOUBLESIDE }, scene);
            break;
        case 'sphere':
            mesh = MeshBuilder.CreateSphere('sphere', { diameter: 3, segments: 32 }, scene);
            break;
        case 'cube':
            mesh = MeshBuilder.CreateBox('cube', { size: 2.5 }, scene);
            break;
        case 'torus':
            mesh = MeshBuilder.CreateTorus('torus', { diameter: 2.5, thickness: 0.8, tessellation: 48 }, scene);
            break;
        case 'cylinder':
            mesh = MeshBuilder.CreateCylinder('cylinder', { height: 3, diameter: 2, tessellation: 32 }, scene);
            break;
        default:
            mesh = MeshBuilder.CreatePlane('plane', { size: 3, sideOrientation: Mesh.DOUBLESIDE }, scene);
    }

    mesh.material = shaderMat;
    currentMeshes = [mesh];

    camera.setTarget(Vector3.Zero());
    camera.radius = 5;
}

// ===================== MESH MANAGEMENT =====================

// ===================== UI EVENTS =====================

// ── Helper: show the preview screen ──────────────────────────────────────────
function enterPreview() {
    document.getElementById('startup-overlay').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'flex';
    const canvas = document.getElementById('renderCanvas');
    canvas.style.display = 'block';
    engine.resize();
}

// ── NME upload handler ────────────────────────────────────────────────────────
function handleNMEUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const config = parseNMEtoPhaser(e.target.result);
            applyShader(config);

            // Store for save feature
            lastConvertedGLSL = config.glsl;
            lastConvertedName = baseName;
            showSaveButton(true);

            enterPreview();
        } catch (err) {
            console.error(err);
            alert('Failed to convert NME shader. See console for details.');
        }
    };
    reader.readAsText(file);
}

// ── GLSL passthrough handler ──────────────────────────────────────────────────
function handleGLSLUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const glsl = e.target.result;
            // Detect if the raw GLSL actually declares any samplers
            const samplerMatches = [...glsl.matchAll(/uniform\s+sampler2D\s+(\w+)/g)];
            const samplers = samplerMatches.map(m => m[1]);
            const config = {
                glsl,
                uniforms: [],   // no auto-detected uniforms for raw GLSL
                samplers,
                defaultValues: {}
            };
            applyShader(config);
            // GLSL files are passthrough — no save button needed
            showSaveButton(false);
            enterPreview();
        } catch (err) {
            console.error(err);
            alert('Failed to load GLSL shader. See console for details.');
        }
    };
    reader.readAsText(file);
}

// ── Save / download converted GLSL ───────────────────────────────────────────
function showSaveButton(visible) {
    const btn = document.getElementById('saveGLSLBtn');
    if (btn) btn.style.display = visible ? 'inline-flex' : 'none';
}

function downloadGLSL() {
    if (!lastConvertedGLSL) return;
    const blob = new Blob([lastConvertedGLSL], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = lastConvertedName + '_converted.glsl';
    a.click();
    URL.revokeObjectURL(url);
}

document.getElementById('saveGLSLBtn')?.addEventListener('click', downloadGLSL);

// ── Startup universal upload (auto-detects NME vs GLSL by content) ──────────────
function handleUniversalUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    handleDrop(file); // reuse the same smart detection logic
}

document.getElementById('universalUpload')?.addEventListener('change', handleUniversalUpload);

// ── In-preview toolbar buttons ────────────────────────────────────────────────
document.getElementById('nmeUpload').addEventListener('change', handleNMEUpload);
document.getElementById('glslUpload').addEventListener('change', handleGLSLUpload);

// ═══════════════════════════════════════════════════════════
//  DRAG & DROP
// ═══════════════════════════════════════════════════════════

const globalDropOverlay = document.getElementById('global-drop-overlay');
const dropZone = document.getElementById('dropZone');
let dragCounter = 0; // track nested dragenter/dragleave

function handleDrop(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        try {
            // ── Four-way format detection ─────────────────────────────
            const trimmed = text.trimStart();
            const isNMEJSON      = (trimmed.startsWith('{') || trimmed.startsWith('[')) && text.includes('"customType"');
            const isJSBlockGraph = text.includes('BABYLON.') && text.includes('Block(');
            const isCompiledNME  = text.includes('// Vertex shader') && text.includes('// Fragment shader');
            const isRawGLSL      = ext === 'glsl' || ext === 'frag';

            let config;
            let formatLabel;

            if (isNMEJSON && !isRawGLSL) {
                formatLabel = 'NME JSON Export';
                config = parseNMEJSON(text);
                lastConvertedGLSL = config.glsl;
                lastConvertedName = file.name.replace(/\.[^.]+$/, '');
                showSaveButton(true);
            } else if (isJSBlockGraph && !isRawGLSL) {
                formatLabel = 'NME Block Graph';
                config = parseNMEtoPhaser(text);
                lastConvertedGLSL = config.glsl;
                lastConvertedName = file.name.replace(/\.[^.]+$/, '');
                showSaveButton(true);
            } else if (isCompiledNME && !isRawGLSL) {
                formatLabel = 'Compiled NME GLSL';
                config = parseCompiledNME(text);
                lastConvertedGLSL = config.glsl;
                lastConvertedName = file.name.replace(/\.[^.]+$/, '') + '_cleaned';
                showSaveButton(true);
            } else {
                formatLabel = 'Raw GLSL';
                const samplerMatches = [...text.matchAll(/uniform\s+sampler2D\s+(\w+)/g)];
                const samplers = samplerMatches.map(m => m[1]);
                config = { glsl: text, uniforms: [], samplers, defaultValues: {} };
                showSaveButton(false);
            }

            applyShader(config);
            enterPreview();

            // Show success notification with format info
            showToast(`✓ Loaded as ${formatLabel}`, 'success');

            // Show conversion warnings if any
            if (config.warnings && config.warnings.length > 0) {
                config.warnings.forEach(w => showToast(`⚠ ${w}`, 'warning', 6000));
            }
        } catch (err) {
            console.error(err);
            showToast(`✗ ${err.message || 'Failed to process shader file'}`, 'error', 8000);
        }
    };
    reader.readAsText(file);
}

// Prevent default browser file-open behaviour everywhere
function preventDefault(e) { e.preventDefault(); e.stopPropagation(); }

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    document.body.addEventListener(evt, preventDefault, false);
});

// Show overlay on enter, hide on leave/drop
document.body.addEventListener('dragenter', () => {
    dragCounter++;
    // During startup show the drop-zone highlight; during preview show the overlay
    if (document.getElementById('startup-overlay')?.style.display !== 'none') {
        dropZone?.classList.add('dragover');
    } else {
        globalDropOverlay?.classList.add('visible');
    }
});

document.body.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        dropZone?.classList.remove('dragover');
        globalDropOverlay?.classList.remove('visible');
    }
});

document.body.addEventListener('drop', (e) => {
    dragCounter = 0;
    dropZone?.classList.remove('dragover');
    globalDropOverlay?.classList.remove('visible');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleDrop(file);
});
// Mesh selector dropdown
const meshSelect = document.getElementById('meshSelect');
const meshUpload = document.getElementById('meshUpload');
const meshUploadBtn = document.getElementById('meshUploadBtn');

meshSelect.addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === 'custom') {
        meshUploadBtn.style.display = 'inline-block';
        meshUploadBtn.click(); // Trigger file picker immediately
    } else {
        meshUploadBtn.style.display = 'none';
        createPrimitive(value);
    }
});

meshUploadBtn.addEventListener('click', () => {
    meshUpload.click();
});

meshUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const fileName = file.name;
    const ext = fileName.split('.').pop().toLowerCase();

    if (!['glb', 'gltf', 'obj', 'babylon'].includes(ext)) {
        alert('Unsupported format. Use GLB, GLTF, or OBJ files.');
        meshSelect.value = 'plane';
        return;
    }

    clearCurrentMeshes();

    try {
        const url = URL.createObjectURL(file);

        const result = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.' + ext);

        URL.revokeObjectURL(url);

        const loadedMeshes = result.meshes.filter(m => m instanceof Mesh && m.getTotalVertices() > 0);

        if (loadedMeshes.length === 0) {
            // Some GLTF files use TransformNodes as parents with child meshes
            const allMeshes = result.meshes.filter(m => m.getChildMeshes().length > 0)
                .flatMap(m => m.getChildMeshes())
                .filter(m => m instanceof Mesh && m.getTotalVertices() > 0);

            if (allMeshes.length > 0) {
                loadedMeshes.push(...allMeshes);
            }
        }

        if (loadedMeshes.length === 0) {
            console.warn('No renderable meshes found in file');
            createPrimitive('plane');
            meshSelect.value = 'plane';
            return;
        }

        applyMaterialToMeshes(loadedMeshes);
        fitMeshesToView(loadedMeshes);
        currentMeshes = loadedMeshes;

        // Show the upload button so they can change the file
        meshUploadBtn.style.display = 'inline-block';

    } catch (err) {
        console.error('Failed to load mesh:', err);
        alert('Failed to load mesh file. Check console for details.');
        createPrimitive('plane');
        meshSelect.value = 'plane';
    }
});

// Texture upload
const imageUpload = document.getElementById('imageUpload');
imageUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file || !shaderMat) return;

    const url = URL.createObjectURL(file);
    const newTex = new Texture(url, scene, false, false);
    newTex.wrapU = Texture.WRAP_ADDRESSMODE;
    newTex.wrapV = Texture.WRAP_ADDRESSMODE;
    
    // Apply to all current active samplers
    activeSamplers.forEach(s => {
        shaderMat.setTexture(s, newTex);
    });
});

// ===================== TIME UPDATE =====================

const startTime = performance.now();
scene.registerBeforeRender(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    if (shaderMat) {
        shaderMat.setFloat('time', elapsed);
        shaderMat.setVector2('resolution', new Vector2(engine.getRenderWidth(), engine.getRenderHeight()));
    }
});

// ===================== GUI =====================

let viewportGui;  // Viewport & preview options
let shaderGui;    // Shader-specific uniforms
const params = {};

function componentToHex(c) {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
}

function updateUniforms(matConfig) {
    if (!shaderMat) return;

    // Sync background colour (scene + grid only — shader no longer uses u_BgColor)
    const bgHex = params['__bgColor__'] || '#1a1a2e';
    activeBgColor.r = parseInt(bgHex.slice(1, 3), 16) / 255;
    activeBgColor.g = parseInt(bgHex.slice(3, 5), 16) / 255;
    activeBgColor.b = parseInt(bgHex.slice(5, 7), 16) / 255;
    scene.clearColor = new Color4(activeBgColor.r, activeBgColor.g, activeBgColor.b, 1.0);

    // Re-color the grid to match background
    if (gridVisible && gridLines.length > 0) {
        const gc = new Color3(
            Math.min(activeBgColor.r + 0.08, 1),
            Math.min(activeBgColor.g + 0.08, 1),
            Math.min(activeBgColor.b + 0.08, 1)
        );
        gridLines.forEach(l => l.color = gc);
    }

    for (const u of matConfig.uniforms) {
        const def = matConfig.defaultValues[u];
        if (!def) continue;
        if (def.type === 'Color3' || def.type === 'Vector3') {
            const r = parseInt(params[u].slice(1, 3), 16) / 255;
            const g = parseInt(params[u].slice(3, 5), 16) / 255;
            const b = parseInt(params[u].slice(5, 7), 16) / 255;
            shaderMat.setColor3(u, new Color3(r, g, b));
        } else if (def.type === 'Vector2') {
            shaderMat.setVector2(u, new Vector2(params[u + '_X'], params[u + '_Y']));
        } else if (def.type === 'Float') {
            shaderMat.setFloat(u, params[u]);
        }
    }
}

function buildGUI(matConfig) {
    // ── 1. Shader uniforms panel (top-right, default lil-gui position) ─────────
    if (shaderGui) shaderGui.destroy();

    const uniformKeys = matConfig.uniforms.filter(u => matConfig.defaultValues[u]);
    if (uniformKeys.length > 0) {
        shaderGui = new GUI({ title: 'Shader Uniforms' });

        for (const u of uniformKeys) {
            const def = matConfig.defaultValues[u];
            if (def.type === 'Color3' || def.type === 'Vector3') {
                params[u] = '#' + componentToHex(def.r) + componentToHex(def.g) + componentToHex(def.b);
                shaderGui.addColor(params, u).name(u).onChange(() => updateUniforms(matConfig));
            } else if (def.type === 'Vector2') {
                const folder = shaderGui.addFolder(u);
                params[u + '_X'] = def.x;
                params[u + '_Y'] = def.y;
                folder.add(params, u + '_X', -5, 5, 0.01).onChange(() => updateUniforms(matConfig));
                folder.add(params, u + '_Y', -5, 5, 0.01).onChange(() => updateUniforms(matConfig));
            } else if (def.type === 'Float') {
                params[u] = def.val;
                shaderGui.add(params, u, -10, 10, 0.01).onChange(() => updateUniforms(matConfig));
            }
        }
    } else {
        shaderGui = null;
    }

    // ── 2. Viewport panel (bottom-right) ──────────────────────────────────────
    if (viewportGui) viewportGui.destroy();
    viewportGui = new GUI({ title: 'Viewport' });
    // Pin to bottom-right via CSS class
    viewportGui.domElement.classList.add('viewport-gui');

    params['__bgColor__'] = '#' + componentToHex(BG_DEFAULT.r)
                                + componentToHex(BG_DEFAULT.g)
                                + componentToHex(BG_DEFAULT.b);
    viewportGui.addColor(params, '__bgColor__').name('Background').onChange(() => updateUniforms(matConfig));

    params['__showGrid__'] = gridVisible;
    viewportGui.add(params, '__showGrid__').name('Show Grid').onChange((v) => toggleGrid(v));

    updateUniforms(matConfig);
}

// ===================== RENDER LOOP =====================

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
