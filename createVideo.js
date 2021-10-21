#!/usr/bin/node
/**
 *  Given a set of AI generated source images and an audio track, generate a
 * video file. Image scale will be adjusted and transition frames will be
 * generated to make the final video as smooth as possible.
 *
 *  For this script to work, you will need to have ImageMagick and FFMPEG
 * installed.
 */
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

// Project-specific values:

// Input image dimensions:
const IMG_WIDTH = 448;
const IMG_HEIGHT = 336;

// Image batch properties:
// Number of images in a batch:
let IMAGES_PER_BATCH = 5;
// The amount the viewpoint zooms in between image batches:
const MAX_ZOOM_SCALE = 600 / 448;

// Number of input images to show per second:
let INPUT_FPS = 2;
// Frame rate to use for the final video. For best results, this should be an
// exact multiple of INPUT_FPS:
const OUTPUT_FPS = 24;

// Nightcafe doubled the number of preview frames they let you download when I
// was partway through this project, so the frame rates and batch size need to
// be adjusted after that index. If you're reusing this project, just set this
// value to -1.
const OUTPUT_DOUBLES_AT_IDX = 180;

// Input paths:
const IMG_SRC_DIR = './images';
const AUDIO_SRC_PATH = './timeMachine.mp3';

// Output paths:
const VIDEO_OUT_PATH = './timeMachine.mp4';
const FRAME_OUT_PATH = './frames';


// Calculate useful values to reuse:
let framesPerImage = OUTPUT_FPS / INPUT_FPS;
// The scale multiplier that controls how much the image will zoom in between
// each frame:
let zoomScalePerFrame = Math.pow(MAX_ZOOM_SCALE,
        1/(framesPerImage * IMAGES_PER_BATCH));

// Check if an image is the first one in a batch created at a new zoom level:
const isStartOfScaleBatch = (imageNum) => ((imageNum % IMAGES_PER_BATCH) === 0);

// Tracks the index of the next frame that will be generated:
let nextFrameIdx = 0;

/**
 *  Get the output path for the next frame, automatically incrementing
 * nextFrameIdx. Frame file names are padded to six digits to simplify the 
 * process of generating the video file.
 *
 * @return {string}  The first indexed frame image path (starting at zero)
 *                   that has not yet been returned by this function.
 * 
 */
function getNextFramePath() {
    let out = nextFrameIdx + "";
    while (out.length < 6) {
        out = '0' + out;
    }
    nextFrameIdx++;
    return path.join(FRAME_OUT_PATH, out + '.jpg');
}

/**
 *  Generates an ImageMagick command to scale and crop a source image when
 * creating a frame image, adjusted by frame to ensure a smooth transition.
 *
 * @param {int} imgIdx  The index of the main image being used to create the
 *                      frame.
 * 
 * @param {int} frameIdx  The index of the frame being generated from the
 *                        source image.
 *
 * @param {bool} isTransitionFrame   When the last image of a batch is being
 *                                  merged with the first image of the next
 *        batch, the image from the next batch needs to be handled differently
 *        because it's at a different zoom level. If this parameter is true,
 *        instead of zooming in the image, the command will zoom out an
 *        appropriate amount, and blur the image's outer borders so it combines
 *        smoothly with the other image.
 *
 * @return {string}  An ImageMagick image conversion command, not including the
 *                   input image path or the output image path.
 */
function getFrameScaleCommand(imgIdx, frameIdx, isTransitionFrame) {
    const maxScaleIdx = IMAGES_PER_BATCH * framesPerImage;
    const scaleRange = MAX_ZOOM_SCALE - 1;

    const scaleIdx = (isTransitionFrame
        ? (framesPerImage - frameIdx)
        : (imgIdx % IMAGES_PER_BATCH) * framesPerImage + frameIdx);
    const scale = Math.pow(zoomScalePerFrame, scaleIdx + 1);

    let sX = IMG_WIDTH, sY = IMG_HEIGHT;

    if (isTransitionFrame) {
        sX /= scale;
        sY /= scale;
    }
    else {
        sX *= scale;
        sY *= scale;
    }

    if (isTransitionFrame) {
        const [xOff, yOff] = [
            [sX, IMG_WIDTH],
            [sY, IMG_HEIGHT]
        ].map(([dim, base]) =>
                scaleIdx === 0 ? 0 : Math.floor((base - dim) / 2));

        return `-resize "${sX}x${sY}^" -gravity SouthEast `
            + `-alpha Set -background none -vignette 100x50 `
            + ` +repage `;
    }
    else {
        const [xOff, yOff] = [
            [sX, IMG_WIDTH],
            [sY, IMG_HEIGHT]
        ].map(([dim, base]) =>
                scaleIdx === 0 ? 0 : Math.floor((dim - base) / 2));

        return `-resize "${sX}x${sY}^" -gravity center -crop `
            + `${IMG_WIDTH}x${IMG_HEIGHT}+${xOff}+${yOff} +repage `;
    }
}

// Count the number of source images before processing them:
let imageCount = 0;
for (let i = 0; fs.existsSync(path.join(IMG_SRC_DIR, + i + '.jpg')); i++) {
    imageCount++;
}
process.stdout.write(`0 frames created, processed 0/${imageCount} images`);


// Iterate through all images to generate frames:
for (let i = 0; i < imageCount; i++) {
    // nightCafe doubled the number of preview frames they let you download
    // partway through this project. Frame rates and batch sizes will need to
    // be doubled after we reach the index where that change happened:
    if (i === OUTPUT_DOUBLES_AT_IDX) {
        INPUT_FPS *= 2;
        IMAGES_PER_BATCH *= 2;
        framesPerImage = OUTPUT_FPS / INPUT_FPS;
        zoomScalePerFrame = Math.pow(MAX_ZOOM_SCALE,
                1/(framesPerImage * IMAGES_PER_BATCH));
    }

    for (let frameIdx = 0; frameIdx < framesPerImage; frameIdx++) {
        let command = `convert ${path.join(IMG_SRC_DIR, i + '.jpg')} `
                + ` ${getFrameScaleCommand(i, frameIdx)} `;
        if (fs.existsSync(path.join(IMG_SRC_DIR, (i + 1) + '.jpg'))) {
            // This is not the last image, frames should fade smoothly between
            // the current image and the next one.
            const nextFrameOpacity = Math.floor((nextFrameIdx % framesPerImage) 
                        / framesPerImage * 100);

            if (nextFrameOpacity > 0) {
                // If the next image is the start of a new batch at a different
                // zoom level, it will need to be scaled differently to
                // compensate before the frames can be merged:
                const isTransitionFrame = isStartOfScaleBatch(i + 1);
                command += `\\( ${path.join(IMG_SRC_DIR, i  + 1 + '.jpg')} `
                        + `-alpha set -channel a -evaluate set `
                        + `${nextFrameOpacity}% +channel `
                        + `${getFrameScaleCommand(i, frameIdx,
                                isTransitionFrame)} \\) `
                        + `-compose over -composite `;
            }
        }
        command += getNextFramePath();
        child_process.execSync(command);
        if ((nextFrameIdx % 100) === 0) {
            process.stdout.write(`\r${nextFrameIdx} frames created, processed `
                    + `${i}/${imageCount} images`);
        }
    }
}

console.log(`Generated ${nextFrameIdx} image frames.`);
console.log(`Starting video generation for ${VIDEO_OUT_PATH}...`);

// Just in case anything goes wrong, if the video already exists, don't really
// delete it until the new video file has been fully created.
const tempBackupPath = VIDEO_OUT_PATH + '.backup';

if (fs.existsSync(VIDEO_OUT_PATH)) {
    fs.renameSync(VIDEO_OUT_PATH, tempBackupPath);
}

child_process.execSync(`ffmpeg -framerate ${OUTPUT_FPS} -i `
        + `${FRAME_OUT_PATH}/%06d.jpg -i ${AUDIO_SRC_PATH} -ss 0 -t `
        + `${Math.floor(nextFrameIdx/OUTPUT_FPS)} ${VIDEO_OUT_PATH}`);

if (fs.existsSync(VIDEO_OUT_PATH)) {
    console.log(`Successfully generated ${VIDEO_OUT_PATH}`);
    if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
    }
}
else {
    console.log(`Failed to create ${VIDEO_OUT_PATH}`);
    if (fs.existsSync(tempBackupPath)) {
        console.log('Restoring previous file version');
        fs.renameSync(tempBackupPath, VIDEO_OUT_PATH);
    }
}
