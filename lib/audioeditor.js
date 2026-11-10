const fs = require('fs');
const path = require('path');
const os = require('os');
const { limited } = require('./limiter');
const { spawn } = require('child_process');

const EFFECTS = {
  bass: ['-af', 'equalizer=f=40:width_type=h:width=50:g=15'],
  blown: ['-af', 'acontrast=d=100'],
  deep: ['-af', 'asetrate=44100*0.8,aresample=44100,atempo=1.25'],
  fast: ['-filter:a', 'atempo=1.5'],
  nightcore: ['-filter:a', 'atempo=1.06,asetrate=44100*1.25'],
  reverse: ['-af', 'areverse'],
  robot: ['-filter_complex', 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'],
  slow: ['-filter:a', 'atempo=0.75'],
  smooth: ['-af', 'lowpass=f=3000,highpass=f=200'],
  squirrel: ['-filter:a', 'asetrate=65000']
};

/**
 * Apply audio effect to audio buffer
 */
async function processAudio(inputBuffer, effectName = 'bass') {
  const filterArgs = EFFECTS[effectName.toLowerCase()] || EFFECTS.bass;
  const tempDir = os.tmpdir();
  const inputFile = path.join(tempDir, `aud_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);
  const outputFile = path.join(tempDir, `aud_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);

  fs.writeFileSync(inputFile, inputBuffer);

  const ffmpegArgs = ['-i', inputFile, ...filterArgs, outputFile];

  return limited(() => new Promise((resolve) => {
    const ff = spawn('ffmpeg', ffmpegArgs);

    ff.on('close', (code) => {
      try { if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile); } catch (e) {}

      if (code === 0 && fs.existsSync(outputFile)) {
        const outData = fs.readFileSync(outputFile);
        try { fs.unlinkSync(outputFile); } catch (e) {}
        resolve(outData);
      } else {
        resolve(inputBuffer);
      }
    });

    ff.on('error', (err) => {
      try { if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile); } catch (e) {}
      if (err && err.code === 'ENOENT') console.error('[AUDIO] ffmpeg Heroku par install nahi hai — ffmpeg buildpack lagayein.');
      resolve(inputBuffer);
    });
  }));
}

module.exports = {
  processAudio,
  EFFECTS: Object.keys(EFFECTS)
};
