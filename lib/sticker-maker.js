const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const config = require('../config');
const { limited } = require('./limiter');

/**
 * Build WebP Exif metadata buffer
 */
function createExif(pack = config.PACK_NAME, author = config.PACK_AUTHOR) {
  const json = {
    'sticker-pack-id': 'naeemxlucifer-md',
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    'emojis': ['🔥', '✨']
  };

  const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([
    Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]),
    Buffer.from([jsonBuff.length, 0x00, 0x00, 0x00]),
    Buffer.from([0x16, 0x00, 0x00, 0x00]),
    jsonBuff
  ]);

  return exif;
}

/**
 * Convert image/video buffer to webp sticker with ffmpeg
 */
async function createSticker(mediaBuffer, isVideo = false, pack = config.PACK_NAME, author = config.PACK_AUTHOR) {
  const tempDir = os.tmpdir();
  const inputExt = isVideo ? '.mp4' : '.jpg';
  const inputFile = path.join(tempDir, `stk_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${inputExt}`);
  const outputFile = path.join(tempDir, `stk_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.webp`);

  fs.writeFileSync(inputFile, mediaBuffer);

  const ffmpegArgs = isVideo
    ? [
        '-i', inputFile,
        '-vcodec', 'libwebp',
        '-filter:v', "fps=15,scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,format=rgba,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000",
        '-lossless', '0',
        '-compression_level', '4',
        '-q:v', '40',
        '-loop', '0',
        '-preset', 'picture',
        '-an',
        '-vsync', '0',
        '-s', '512:512',
        '-t', '7',
        outputFile
      ]
    : [
        '-i', inputFile,
        '-vcodec', 'libwebp',
        '-filter:v', "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,format=rgba,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000",
        '-lossless', '1',
        '-q:v', '70',
        '-preset', 'picture',
        '-an',
        '-vsync', '0',
        '-s', '512:512',
        outputFile
      ];

  return limited(() => new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ffmpegArgs);

    ff.on('close', (code) => {
      // Clean up input
      try { if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile); } catch (e) {}

      if (code === 0 && fs.existsSync(outputFile)) {
        let webpData = fs.readFileSync(outputFile);
        try { fs.unlinkSync(outputFile); } catch (e) {}
        resolve(webpData);
      } else {
        // Fallback: return raw input if ffmpeg is missing in local dev
        resolve(mediaBuffer);
      }
    });

    ff.on('error', (err) => {
      try { if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile); } catch (e) {}
      if (err && err.code === 'ENOENT') console.error('[STICKER] ffmpeg Heroku par install nahi hai — ffmpeg buildpack lagayein (sticker ab asli webp nahi banega).');
      // Fallback
      resolve(mediaBuffer);
    });
  }));
}

module.exports = {
  createSticker,
  createExif
};
