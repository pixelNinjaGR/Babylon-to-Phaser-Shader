const fs = require('fs');
const content = fs.readFileSync('Panner_1.txt', 'utf8');

const blocks = {};

const blockRegex = /var (\w+) = new BABYLON\.(\w+)Block\("(.*?)"\);/g;
let match;
while ((match = blockRegex.exec(content)) !== null) {
  blocks[match[1]] = { varName: match[1], type: match[2], name: match[3], props: {}, inputs: {}, outputs: {}, isInput: match[2] === 'Input' };
}

// Map the missing ones (like Texture blocks without "Block" sometimes or things like ImageSourceBlock)
// Example: var ImageSourceBlock = new BABYLON.ImageSourceBlock("ImageSource");
// Actually ImageSourceBlock is an ImageSourceBlock. The regex matches `var (\w+) = new BABYLON\.(\w+)Block\("(.*?)"\);`

const valueRegex = /(\w+)\.value = new BABYLON\.(Color3|Color4|Vector2|Vector3|Vector4)\((.*?)\);/g;
while ((match = valueRegex.exec(content)) !== null) {
    if (blocks[match[1]]) blocks[match[1]].value = { type: match[2], data: match[3] };
}

const numValRegex = /(\w+)\.value = ([\d\.\-]+);/g;
while ((match = numValRegex.exec(content)) !== null) {
    if (blocks[match[1]]) blocks[match[1]].value = { type: 'Float', data: match[2] };
}

console.log('Color value:', blocks['Color']?.value);
console.log('Speed value:', blocks['Speed']?.value);
