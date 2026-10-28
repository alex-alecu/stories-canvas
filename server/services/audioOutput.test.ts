import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { prepareNarrationAudio } from './audioOutput.js';

test('quiet PCM becomes MP3 at a clear playback level', async () => {
  const pcm = Buffer.alloc(24_000 * 2 * 4);
  for (let n = 0; n < pcm.length / 2; n++) pcm.writeInt16LE(Math.round(200 * Math.sin(n * 2 * Math.PI * 440 / 24_000)), n * 2);
  const mp3 = await prepareNarrationAudio(pcm, 'pcm');
  assert.equal(mp3.subarray(0, 3).toString(), 'ID3');
  const child = execFile(ffmpegPath!, ['-hide_banner', '-nostats', '-i', 'pipe:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  child.stdin!.end(mp3);
  const { stderr } = await new Promise<{stderr: string}>((resolve, reject) => {
    let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve({stderr}) : reject(new Error(stderr)));
  });
  const level = JSON.parse(stderr.slice(stderr.lastIndexOf('{')));
  assert.ok(Math.abs(Number(level.input_i) + 16) < 1, stderr);
  assert.ok(Number(level.input_tp) <= -1.5, stderr);
});

test('invalid or cancelled audio cannot become a saved MP3', async () => {
  await assert.rejects(prepareNarrationAudio(Buffer.from('not audio'), 'mp3'), /audio|ffmpeg/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareNarrationAudio(Buffer.from('not audio'), 'mp3', controller.signal), /abort/i);
});
