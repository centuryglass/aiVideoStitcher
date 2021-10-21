#!/usr/bin/node
/**
 *  Imports nightcafe images, labels them by creation time, and automatically
 * scales the last one to use as the source image for generating the next set
 * of frames.
 *
 *  For this script to work, ImageMagick must be installed and available on
 * your path.
 */
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

// Project-specific parameters:

// Directory to search for downloaded images. Make sure you don't have any
// other .jpg files here!
const IMG_SRC_DIR = '~/Downloads';

// Directory to store numbered images after they are imported
const SORTED_IMG_OUT_DIR = './images';

// A copy of the most recent image will be scaled by this ratio, then cropped
// to the usual image size, to use as the source image for the next batch of
// AI images.  Using a scaled image to generate the next set of images will
// give your final video more motion,and give the AI more empty spaces to fill
// in with new details.
const SCALE = 600/448;

// Directory where the scaled image will be saved:
const SCALED_IMG_OUT_DIR = '.';

// Source image dimensions:
const WIDTH = 448;
const HEIGHT = 336;

// Utility functions: generate an image path from an image index:
const sortedPath = (i) => path.join(SORTED_IMG_OUT_DIR, i + '.jpg');
const scaledPath = (i) => path.join(SCALED_IMG_OUT_DIR, i + '_scaled.jpg');

// Scan existing images to figure out what the next image number should be, 
// and remove any old scaled images from previous batches that should no longer
// be necessary.
let lastIdx = -1;
while (fs.existsSync(sortedPath(lastIdx + 1))) {
    const oldScaledImg = scaledPath(lastIdx + 1);
    if (fs.existsSync(oldScaledImg)) {
        console.log(`Removing last scaled input file ${oldScaledImg}`);
        fs.unlinkSync(oldScaledImg);
    }
    lastIdx++;
}

// Find all .jpg files in IMG_SRC_DIR that aren't already formatted as numbered
// images. This rule means you can safely use the same directory for
// IMG_SRC_DIR and SORTED_IMG_OUT_DIR if you want.
let unlabeledPaths = [];
const labeledPattern = /^[0-9]+.jpg$/;
for (let filePath of fs.readdirSync(IMG_SRC_DIR)) {
    if (! (path.extname(filePath) === '.jpg')) {
        continue;
    }
    if (! labeledPattern.test(path.basename(filePath))) {
        console.log('Found unsorted image: ' + path.basename(filePath));
        unlabeledPaths.push(path.join(IMG_SRC_DIR, filePath));
    }
}

// Sort all identified images by creation time, number them, and move them to
// the sorted image directory:
if (unlabeledPaths.length > 0) {
    console.log(`Labelling ${unlabeledPaths.length} images by creation time`);
    unlabeledPaths.sort((a, b) => {
        return fs.statSync(a).birthtimeMs - fs.statSync(b).birthtimeMs;
    });
    for (let imgPath of unlabeledPaths) {
        lastIdx++;
        if (fs.existsSync(sortedPath(lastIdx))) {
            console.log(`Something went wrong, ${lastIdx}.jpg already exists!`);
            process.exit(1);
        }
        fs.renameSync(imgPath, sortedPath(lastIdx));
    }
}

// Create the output image:
console.log(`Creating ${lastIdx}_scaled.jpg`);

const sW = WIDTH * SCALE;
const sH = HEIGHT * SCALE;
child_process.execSync(`convert ${sortedPath(lastIdx)} -resize `
        + `"${sW}x${sH}^" -gravity center `
        + `-crop ${WIDTH}x${HEIGHT}+${Math.floor((sW - WIDTH) / 2)}+`
        + `${Math.floor((sH - HEIGHT) / 2)} +repage ${scaledPath}`);
