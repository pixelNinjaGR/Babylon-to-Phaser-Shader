import { parseCompiledNME } from './src/shaderConverter.js';

const compiledShader = `// Vertex shader
#if defined(WEBGL2) || defined(WEBGPU)
precision highp sampler2DArray;
#endif
precision highp float;

//Attributes
attribute vec3 position;
#ifdef UV1
attribute vec2 uv;
#else
vec2 uv = vec2(0.);
#endif


//Uniforms
uniform mat4 u_World;
uniform mat4 u_ViewProjection;
uniform float u_Speed;
uniform float u_Time;
#ifdef UVTRANSFORM0
uniform mat4 textureTransform;
#endif


//Samplers
uniform  sampler2D ImageSourceBlock; 


//Varyings
#ifdef UVTRANSFORM0
varying vec2 transformedUV;
#endif
#ifdef VMAINXY
varying vec2 vMainxy;
#endif




//Entry point
void main(void) {

//WorldPos
vec4 output1 = u_World * vec4(position, 1.0);

//WorldPos * ViewProjectionTransform
vec4 output0 = u_ViewProjection * output1;

//VertexOutput
gl_Position = output0;

//VectorSplitter
float x = uv.x;
float y = uv.y;

//Multiply
float output3 = x * u_Speed;

//Subtract
float output2 = output3 - u_Time;

//VectorMerger
vec2 xy = vec2(output2, y).xy;

//ImageSourceBlock

//Texture
#ifdef UVTRANSFORM0
transformedUV = vec2(textureTransform * vec4(xy.xy, 1.0, 0.0));
#elif defined(VMAINXY)
vMainxy = xy.xy;
#endif

}

// Fragment shader
#if defined(PREPASS)
#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[SCENE_MRT_COUNT];
highp vec4 gl_FragColor;
#endif
#if defined(WEBGL2) || defined(WEBGPU)
precision highp sampler2DArray;
#endif
precision highp float;

//Uniforms
uniform mat4 u_World;
uniform mat4 u_ViewProjection;
uniform float u_Speed;
uniform float u_Time;
#ifdef UVTRANSFORM0
uniform mat4 textureTransform;
#endif
uniform float textureInfoName;
uniform float useAdditionalColor;


//Samplers
uniform  sampler2D ImageSourceBlock; 


//Varyings
#ifdef UVTRANSFORM0
varying vec2 transformedUV;
#endif
#ifdef VMAINXY
varying vec2 vMainxy;
#endif


//Texture
#include<helperFunctions>



//Entry point
void main(void) {

//ImageSourceBlock

//Texture
#ifdef UVTRANSFORM0
vec4 tempTextureRead1 = texture2D(ImageSourceBlock, transformedUV);
#elif defined(VMAINXY)
vec4 tempTextureRead1 = texture2D(ImageSourceBlock, vMainxy);
#endif
vec3 rgb = tempTextureRead1.rgb * textureInfoName;
#ifdef ISLINEAR1
                    rgb = toGammaSpace(rgb);
                    #endif
                #ifdef ISGAMMA1
                rgb = toLinearSpace(rgb);
                #endif
            float a = tempTextureRead1.a * textureInfoName;

//FragmentOutput
#ifdef USEADDITIONALCOLOR0
gl_FragColor  = vec4(rgb, a);
#else
gl_FragColor  = vec4(rgb, a);
#endif
#ifdef CONVERTTOLINEAR0
gl_FragColor  = toLinearSpace(gl_FragColor);
#endif
#ifdef CONVERTTOGAMMA0
gl_FragColor  = toGammaSpace(gl_FragColor);
#endif
#if defined(PREPASS)
gl_FragData[0] = gl_FragColor;
#endif

}`;

try {
    const result = parseCompiledNME(compiledShader);
    console.log('=== VERTEX SHADER ===');
    console.log(result.vertexShader);
    console.log('\n=== FRAGMENT SHADER ===');
    console.log(result.glsl);
    console.log('\n=== CONFIG ===');
    console.log('uniforms:', result.uniforms);
    console.log('samplers:', result.samplers);
    console.log('defaultValues:', result.defaultValues);
    console.log('hasAlpha:', result.hasAlpha);
} catch (err) {
    console.error('ERROR:', err.message);
}
