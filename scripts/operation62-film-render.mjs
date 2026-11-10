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
const source90 = path.join(root, 'docs/evidence/operation-60/stage-4/control-deck-90s.mp4');
const source180 = path.join(root, 'docs/evidence/operation-60/stage-4/control-deck-3min.mp4');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verequo-op62-film-'));
const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
const fps = 30;
const preset = 'medium';
const crf = '19';

for (const file of [logo, source90, source180, path.join(slidesDir, 'slide-01.png')]) {
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
    ? ['OPERATION 62 EDIT  |  UI FOOTAGE: OPERATION 60']
    : [
        'MARKET_RISK_UNVERIFIED  |  T6 MISSING',
        'UI footage: Operation 60; current deck: Operation 62.',
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
function renderSource(source, seconds, file) {
  const vf = 'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,setsar=1,format=yuv420p';
  ffmpeg(['-i', source, '-t', String(seconds), '-vf', vf, ...encodeArgs(file)]);
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

const intro = path.join(tmp, 'intro.mp4');
const outro = path.join(tmp, 'outro.mp4');
const src90 = path.join(tmp, 'source-90-cut.mp4');
const src180 = path.join(tmp, 'source-180-cut.mp4');
renderCard('intro', intro);
renderCard('outro', outro);
renderSource(source90, 84, src90);
renderSource(source180, 174, src180);

const demo90 = path.join(outDir, 'VEREQO_OPERATION62_DEMO_90S_SILENT.mp4');
const deck180 = path.join(outDir, 'VEREQO_OPERATION62_CONTROL_DECK_3MIN_SILENT.mp4');
const main420 = path.join(outDir, 'VEREQO_OPERATION62_MAIN_FILM_7MIN_SILENT_PREVIEW.mp4');
concat([intro, src90, outro], demo90);
concat([intro, src180, outro], deck180);

const mainParts = [intro, src180];
for (let n = 1; n <= 14; n++) {
  const frames = n <= 4 ? 515 : 514;
  const segment = path.join(tmp, `deck-slide-${String(n).padStart(2, '0')}.mp4`);
  renderSlide(n, frames, segment);
  mainParts.push(segment);
}
mainParts.push(outro);
concat(mainParts, main420);

const sourceHashes = {
  operation60_90s: hash(source90),
  operation60_3min: hash(source180),
  operation62DeckSlide1: hash(path.join(slidesDir, 'slide-01.png')),
  operation62DeckSlide14: hash(path.join(slidesDir, 'slide-14.png')),
  logo: hash(logo)
};
const outputs = [demo90, deck180, main420].map(file => ({
  path: path.relative(root, file),
  sha256: hash(file),
  ...inspect(file)
}));
const expectedSeconds = [90, 180, 420];
const validation = {
  operation: '62',
  renderedAt: new Date().toISOString(),
  status: outputs.every((x, i) => x.codec?.startsWith('h264') && x.width === 1440 && x.height === 900 && !x.audioStream && Math.abs(x.seconds - expectedSeconds[i]) <= 0.04) ? 'PASS_SILENT_VIDEO_CUTS' : 'FAIL',
  audioDisclosure: 'No audio stream or generated voice. Existing source footage contains baked English captions; the seven-minute narration SRT remains an editable script cue sheet.',
  footageDisclosure: 'The UI footage is reused from the preserved Operation 60 silent captures. The final 4 minutes of the main film use reviewed Operation 62 pitch-deck slide renders. No wallet signature, order, fill, or transaction is shown.',
  sourceHashes,
  outputs
};
fs.writeFileSync(path.join(outDir, 'operation62-film-render-validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
if (validation.status !== 'PASS_SILENT_VIDEO_CUTS') process.exitCode = 1;
