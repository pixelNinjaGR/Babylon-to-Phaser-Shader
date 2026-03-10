import * as BABYLON from '@babylonjs/core';

const content = `
var nodeMaterial = new BABYLON.NodeMaterial(" ");
nodeMaterial.mode = BABYLON.NodeMaterialModes.Material;

// InputBlock
var position = new BABYLON.InputBlock("position");
position.visibleInInspector = false;
position.visibleOnFrame = false;
position.target = 1;
position.setAsAttribute("position");

// TransformBlock
var WorldPos = new BABYLON.TransformBlock("WorldPos");
WorldPos.visibleInInspector = false;
WorldPos.visibleOnFrame = false;
WorldPos.target = 1;
WorldPos.complementZ = 0;
WorldPos.complementW = 1;

// InputBlock
var World = new BABYLON.InputBlock("World");
World.visibleInInspector = false;
World.visibleOnFrame = false;
World.target = 1;
World.setAsSystemValue(BABYLON.NodeMaterialSystemValues.World);

// TransformBlock
var WorldPosViewProjectionTransform = new BABYLON.TransformBlock("WorldPos * ViewProjectionTransform");
WorldPosViewProjectionTransform.visibleInInspector = false;
WorldPosViewProjectionTransform.visibleOnFrame = false;
WorldPosViewProjectionTransform.target = 1;
WorldPosViewProjectionTransform.complementZ = 0;
WorldPosViewProjectionTransform.complementW = 1;

// InputBlock
var ViewProjection = new BABYLON.InputBlock("ViewProjection");
ViewProjection.visibleInInspector = false;
ViewProjection.visibleOnFrame = false;
ViewProjection.target = 1;
ViewProjection.setAsSystemValue(BABYLON.NodeMaterialSystemValues.ViewProjection);

// VertexOutputBlock
var VertexOutput = new BABYLON.VertexOutputBlock("VertexOutput");
VertexOutput.visibleInInspector = false;
VertexOutput.visibleOnFrame = false;
VertexOutput.target = 1;

// InputBlock
var Color = new BABYLON.InputBlock("Color3");
Color.visibleInInspector = false;
Color.visibleOnFrame = false;
Color.target = 1;
Color.value = new BABYLON.Color3(0.9882352941176471, 0.03529411764705882, 0.30980392156862746);
Color.isConstant = false;

// LerpBlock
var Lerp = new BABYLON.LerpBlock("Lerp");
Lerp.visibleInInspector = false;
Lerp.visibleOnFrame = false;
Lerp.target = 4;

// InputBlock
var Color1 = new BABYLON.InputBlock("Color3");
Color1.visibleInInspector = false;
Color1.visibleOnFrame = false;
Color1.target = 1;
Color1.value = new BABYLON.Color3(0.5843137254901961, 0.6313725490196078, 0.8666666666666667);
Color1.isConstant = false;

// FragmentOutputBlock
var FragmentOutput = new BABYLON.FragmentOutputBlock("FragmentOutput");
FragmentOutput.visibleInInspector = false;
FragmentOutput.visibleOnFrame = false;
FragmentOutput.target = 2;
FragmentOutput.convertToGammaSpace = false;
FragmentOutput.convertToLinearSpace = false;
FragmentOutput.useLogarithmicDepth = false;

// Connections
position.output.connectTo(WorldPos.vector);
World.output.connectTo(WorldPos.transform);
WorldPos.output.connectTo(WorldPosViewProjectionTransform.vector);
ViewProjection.output.connectTo(WorldPosViewProjectionTransform.transform);
WorldPosViewProjectionTransform.output.connectTo(VertexOutput.vector);
Color.output.connectTo(Lerp.left);
Color1.output.connectTo(Lerp.right);
Lerp.output.connectTo(FragmentOutput.rgb);

// Build the node material
nodeMaterial.addOutputNode(VertexOutput);
nodeMaterial.addOutputNode(FragmentOutput);
nodeMaterial.build();

console.log("VERTEX SHADER:");
console.log(nodeMaterial.compiledShaders);
`;

import fs from 'fs';
fs.writeFileSync('testBabylonCompile.js', content, 'utf8');
