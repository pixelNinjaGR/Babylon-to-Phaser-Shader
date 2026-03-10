// Converted Babylon Node Material Fragment Shader for Phaser
// Uses Phaser's default vertex shader varyings: fragCoord, outTexCoord
precision mediump float;

// Built-in Phaser uniforms
uniform float time;
uniform vec2 resolution;
uniform sampler2D iChannel0;

// Custom Uniforms from Babylon Node Material Graph
uniform vec3 u_Color;
uniform vec3 u_Color1;
uniform vec2 u_Speed_Noise;
uniform vec2 u_Distortion;
uniform vec2 u_Speed;
uniform vec3 u_BgColor;

// Phaser's default vertex shader provides these varyings
varying vec2 fragCoord;
varying vec2 outTexCoord;

void main(void) {
    // Normalized UV (0..1)
    vec2 uv = fragCoord / resolution;
    
    // --- Panner 1: scroll noise UV ---
    vec2 noiseUV = fract(uv + u_Speed_Noise * time);
    
    // Read the Green channel of the noise texture for color mixing
    float g_noise = texture2D(iChannel0, noiseUV).g;
    
    // Multiply by Distortion vector
    vec2 distortion = u_Distortion * g_noise;
    
    // Add distortion to UV, then apply second scroll (Speed)
    vec2 distortedUV = uv + distortion;
    
    // --- Panner 2: scroll distorted UV ---
    vec2 finalUV = fract(distortedUV + u_Speed * time);
    
    // --- Alpha mask from the Red channel at the final UV ---
    float alphaMask = texture2D(iChannel0, finalUV).r;
    
    // --- Color mixing ---
    vec3 mixedColor = mix(u_Color, u_Color1, g_noise);
    
    // Phaser Shader objects don't alpha-blend; do it manually in the shader
    // Blend the shader color with the background using the alpha mask
    vec3 finalColor = mix(u_BgColor, mixedColor, alphaMask);
    
    gl_FragColor = vec4(finalColor, 1.0);
}
