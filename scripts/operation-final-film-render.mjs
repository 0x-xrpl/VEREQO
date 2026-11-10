#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'submission/hacker-house-2026/media');
const slidesDir = path.join(root, 'docs/evidence/operation-62/pitch-deck/slides-v2');
const logo = path.join(root, 'apps/web/public/brand/VEREQO_HORIZONTAL_SOLID.png');
const source180 = path.join(root, 'docs/evidence/operation-60/stage-4/control-deck-3min.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verequo-op62-film-'));
const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
const fps = 30;
const preset = 'medium';
const crf = '19';

for (const file of [logo, source180, path.join(slidesDir, 'slide-02.png'), path.join(slidesDir, 'slide-05.png'), path.join(slidesDir, 'slide-06.png'), path.join(slidesDir, 'slide-09.png'), path.join(slidesDir, 'slide-10.png'), path.join(slidesDir, 'slide-11.png')]) {
  if (!fs.existsSync(file)) throw new Error(`required local source missing: ${path.relative(root, file)}`);
}
if (!fs.existsSync(font)) throw new Error(`local font unavailable: ${font}`);
fs.mkdirSync(outDir, { recursive: true });

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}
function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function encodeArgs(out) {
  return ['-an', '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out];
}
function renderCard(label, file) {
  const isIntro = label === 'intro';
  const titleLines = isIntro
    ? ['PROVE WHAT MATTERS.', 'CONTROL WHAT FOLLOWS.']
    : ['READ-ONLY TESTNET', 'ORDER EXECUTION: NO-GO'];
  const noteLines = isIntro
    ? ['OPERATION FINAL REVIEW CUT  |  UI FOOTAGE: OPERATION 60']
    : [
        'MARKET_RISK_UNVERIFIED  |  T6 MISSING',
        'Silent local review cut; voice and music are not included.',
        'No order, signature, or funds movement shown.'
      ];
  const textPath = (kind, index, text) => {
    const textFile = path.join(tmp, `${label}-${kind}-${index}.txt`);
    fs.writeFileSync(textFile, text);
    return textFile;
  };
  const titleFiles = titleLines.map((line, i) => textPath('title', i, line));
  const noteFiles = noteLines.map((line, i) => textPath('note', i, line));
  let graph = '[1:v]scale=720:-1[logo];[0:v][logo]overlay=(W-w)/2:215';
  titleFiles.forEach((filePath, i) => {
    graph += `,drawtext=fontfile=${font}:textfile=${filePath}:fontcolor=0x171a1b:fontsize=42:x=(w-text_w)/2:y=${440 + i * 58}`;
  });
  graph += ',drawbox=x=280:y=568:w=880:h=2:color=0xe3e6e5:t=fill';
  noteFiles.forEach((filePath, i) => {
    graph += `,drawtext=fontfile=${font}:textfile=${filePath}:fontcolor=0x555b5d:fontsize=24:x=(w-text_w)/2:y=${600 + i * 34}`;
  });
  graph += ',format=yuv420p[v]';
  ffmpeg(['-f', 'lavfi', '-i', `color=c=white:s=1440x900:r=${fps}:d=3`, '-loop', '1', '-framerate', String(fps), '-i', logo, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(3 * fps), ...encodeArgs(file)]);
}
function renderSource(source, startSeconds, seconds, file) {
  const vf = 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,setsar=1,format=yuv420p';
  ffmpeg(['-ss', String(startSeconds), '-i', source, '-t', String(seconds), '-vf', vf, ...encodeArgs(file)]);
}
function renderSlide(slideNo, frames, file) {
  const input = path.join(slidesDir, `slide-${String(slideNo).padStart(2, '0')}.png`);
  if (!fs.existsSync(input)) throw new Error(`missing reviewed slide: ${input}`);
  const vf = 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,setsar=1,format=yuv420p';
  ffmpeg(['-loop', '1', '-framerate', String(fps), '-i', input, '-vf', vf, '-frames:v', String(frames), ...encodeArgs(file)]);
}
function concat(parts, output) {
  const list = path.join(tmp, `${path.basename(output)}.concat.txt`);
  const content = parts.map(p => `file '${p.replaceAll("'", "'\\''")}'`).join('\n') + '\n';
  fs.writeFileSync(list, content);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output]);
}
function inspect(file) {
  let output = '';
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    output = String(error.stderr || '');
  }
  const duration = output.match(/Duration: ([0-9:.]+)/)?.[1] || null;
  const video = output.match(/Video: ([^,]+),.*?(\d{3,5})x(\d{3,5})/);
  const audio = /Audio:/.test(output);
  const seconds = duration ? duration.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) : null;
  return { duration, seconds, codec: video?.[1] || null, width: Number(video?.[2] || 0), height: Number(video?.[3] || 0), audioStream: audio };
}

const main420 = path.join(outDir, 'VEREQO_OPERATION_FINAL_MAIN_FILM_4M20S_SILENT_REVIEW.mp4');
const intro = path.join(tmp, 'intro.mp4');
const outro = path.join(tmp, 'outro.mp4');
const src180 = path.join(tmp, 'source-180-cut.mp4');
renderCard('intro', intro);
renderCard('outro', outro);
renderSource(source180, 3, 174, src180);

const slideNumbers = [5, 6, 9, 11, 10, 14];
const mainParts = [intro, src180];
for (const n of slideNumbers) {
  const segment = path.join(tmp, 'deck-slide-' + String(n).padStart(2, '0') + '.mp4');
  renderSlide(n, 400, segment);
  mainParts.push(segment);
}
mainParts.push(outro);
concat(mainParts, main420);

const sourceHashes = {
  operation60_3min: hash(source180),
  operation62DeckSlides: Object.fromEntries([5, 6, 9, 11, 10, 14].map(n => [
    'slide-' + String(n).padStart(2, '0'),
    hash(path.join(slidesDir, 'slide-' + String(n).padStart(2, '0') + '.png'))
  ])),
  logo: hash(logo)
};
const outputs = [{
  path: path.relative(root, main420),
  sha256: hash(main420),
  ...inspect(main420)
}];
const validation = {
  operation: 'FINAL',
  renderedAt: new Date().toISOString(),
  status: outputs[0].codec?.startsWith('h264') && outputs[0].width === 1440 && outputs[0].height === 900 && !outputs[0].audioStream && Math.abs(outputs[0].seconds - 260) <= 0.04 ? 'PASS_SILENT_4M20S_REVIEW_CUT' : 'FAIL',
  audioDisclosure: 'No audio stream is included. No voice or music has been licensed, recorded, or generated.',
  footageDisclosure: 'The 174-second screen capture is preserved Operation 60 material. Six selected Operation 62 deck slides follow it. This review cut adds no fresh Testnet, wallet, signature, order, fill, or transaction evidence.',
  composition: { introSeconds: 3, operation60FootageSeconds: 174, selectedDeckSlides: [5, 6, 9, 11, 10, 14], framesPerSlide: 400, secondsPerSlide: 13.3333333333, outroSeconds: 3 },
  sourceHashes,
  outputs
};
fs.writeFileSync(path.join(outDir, 'operation-final-film-render-validation.json'), JSON.stringify(validation, null, 2) + '\n');
console.log(JSON.stringify(validation, null, 2));
if (validation.status !== 'PASS_SILENT_4M20S_REVIEW_CUT') process.exitCode = 1;
