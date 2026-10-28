import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export type AudioResponseFormat = 'mp3' | 'pcm';

async function processAudio(input: Buffer, args: string[], signal?: AbortSignal): Promise<{ stdout: Buffer; stderr: string }> {
  signal?.throwIfAborted();
  const encoder = ffmpegPath;
  if (!encoder) throw new Error('The audio encoder is not available on this platform.');
  return new Promise((resolve, reject) => {
    const child = execFile(encoder, ['-hide_banner', '-nostats', ...args], {
      encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, signal,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error('Audio processing failed.', { cause: error }));
      else resolve({ stdout, stderr: stderr.toString() });
    });
    // Invalid input can close the pipe before all input has been written.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/** Convert provider audio to MP3 and give all narration the same playback level. */
export async function prepareNarrationAudio(input: Buffer, format: AudioResponseFormat, signal?: AbortSignal): Promise<Buffer> {
  const source = format === 'pcm' ? ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0'] : ['-i', 'pipe:0'];
  const analysis = await processAudio(input, [...source, '-af', 'loudnorm=I=-16:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], signal);
  const level = JSON.parse(analysis.stderr.slice(analysis.stderr.lastIndexOf('{'))) as Record<string, string>;
  const measurements = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].map(key => Number(level[key]));
  if (!measurements.every(Number.isFinite)) throw new Error('The generated audio contains no measurable speech.');
  const [i, tp, lra, threshold, offset] = measurements;
  const filter = `loudnorm=I=-16:TP=-2:LRA=11:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${threshold}:offset=${offset}:linear=true`;
  const result = await processAudio(input, [...source, '-af', filter, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], signal);
  if (result.stdout.length === 0) throw new Error('The audio encoder returned no MP3 data.');
  return result.stdout;
}
