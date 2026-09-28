import type pino from "pino";

import { Pcm16MonoResampler } from "../../../../agent/pcm16-resampler.js";
import { pcm16lePeakAbs, pcm16leToFloat32 } from "../../../audio.js";
import type { SherpaVadSegment, SherpaVadSegmentation } from "./sherpa-vad-segmenter.js";

const DEFAULT_SILENCE_PEAK_THRESHOLD = 300;
const TARGET_PEAK = 0.6;
const MAX_GAIN = 50;

// SenseVoice is trained on short segments. Longer buffers get split on VAD
// silence; oversized single segments are cut at their quietest window.
const LONG_AUDIO_THRESHOLD_SECONDS = 30;
const MAX_SEGMENT_SECONDS = 30;
const SEGMENT_PADDING_SECONDS = 0.4;
const SPLIT_SEARCH_SECONDS = 5;
const SPLIT_WINDOW_SECONDS = 0.1;
const MIN_TAIL_SECONDS = 0.5;

const CJK_PATTERN =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

export interface SherpaSttStream {
  free?(): void;
}

export interface SherpaSttDecoderEngine {
  sampleRate: number;
  createStream(): SherpaSttStream;
  acceptWaveform(stream: SherpaSttStream, sampleRate: number, samples: Float32Array): void;
  recognizer: {
    decode(stream: SherpaSttStream): void;
    getResult(stream: SherpaSttStream): { text?: string } | string | undefined;
  };
}

export interface SherpaSttDecoderConfig {
  engine: SherpaSttDecoderEngine;
  silencePeakThreshold?: number;
  vad?: { segmenter: SherpaVadSegmentation };
}

export interface SherpaSttDecodeResult {
  text: string;
  isLowConfidence: boolean;
}

interface ChunkBounds {
  start: number;
  end: number;
}

export class SherpaSttDecoder {
  public readonly sampleRate: number;

  private readonly engine: SherpaSttDecoderEngine;
  private readonly silencePeakThreshold: number;
  private readonly vad: { segmenter: SherpaVadSegmentation } | null;
  private readonly logger: pino.Logger;

  constructor(config: SherpaSttDecoderConfig, logger: pino.Logger) {
    this.engine = config.engine;
    this.sampleRate = config.engine.sampleRate;
    this.silencePeakThreshold = config.silencePeakThreshold ?? DEFAULT_SILENCE_PEAK_THRESHOLD;
    this.vad = config.vad ?? null;
    this.logger = logger.child({ module: "speech", provider: "local", component: "stt-decoder" });
  }

  decode(pcm16: Buffer, inputRate: number): SherpaSttDecodeResult {
    if (pcm16.length === 0 || pcm16lePeakAbs(pcm16) < this.silencePeakThreshold) {
      return { text: "", isLowConfidence: true };
    }

    const resampled =
      inputRate === this.sampleRate
        ? pcm16
        : new Pcm16MonoResampler({ inputRate, outputRate: this.sampleRate }).processChunk(pcm16);
    const samples = pcm16leToFloat32(resampled, 1);

    if (!this.vad) {
      return this.decodeChunk(samples);
    }

    const segments = this.vad.segmenter.segment(samples);
    if (segments.length === 0) {
      this.logger.debug(
        { durationSeconds: samples.length / this.sampleRate },
        "Detected no speech; skipping transcription",
      );
      return { text: "", isLowConfidence: true };
    }

    const durationSeconds = samples.length / this.sampleRate;
    if (durationSeconds <= LONG_AUDIO_THRESHOLD_SECONDS) {
      return this.decodeChunk(samples);
    }

    const bounds = planChunks({ samples, segments, sampleRate: this.sampleRate });
    this.logger.debug(
      { durationSeconds, segments: segments.length, chunks: bounds.length },
      "Splitting long audio for transcription",
    );
    const parts = bounds.map(
      (chunk) => this.decodeChunk(samples.subarray(chunk.start, chunk.end)).text,
    );
    return toResult(joinTranscripts(parts));
  }

  private decodeChunk(samples: Float32Array): SherpaSttDecodeResult {
    const peak = peakAbs(samples);
    const gain = peak > 0 && peak < TARGET_PEAK ? Math.min(MAX_GAIN, TARGET_PEAK / peak) : 1;

    const stream = this.engine.createStream();
    try {
      this.engine.acceptWaveform(stream, this.sampleRate, applyGain(samples, gain));
      this.engine.recognizer.decode(stream);
      const result = this.engine.recognizer.getResult(stream);
      const text = String(
        (typeof result === "object" && result && "text" in result ? result.text : undefined) ??
          result ??
          "",
      ).trim();
      return toResult(text);
    } finally {
      try {
        stream.free?.();
      } catch {
        // ignore
      }
    }
  }
}

function toResult(text: string): SherpaSttDecodeResult {
  return text.length === 0 ? { text: "", isLowConfidence: true } : { text, isLowConfidence: false };
}

function planChunks(params: {
  samples: Float32Array;
  segments: SherpaVadSegment[];
  sampleRate: number;
}): ChunkBounds[] {
  const { samples, segments, sampleRate } = params;
  const paddingSamples = Math.round(SEGMENT_PADDING_SECONDS * sampleRate);
  const maxSegmentSamples = Math.round(MAX_SEGMENT_SECONDS * sampleRate);
  const bounds: ChunkBounds[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previousEnd = index === 0 ? 0 : segments[index - 1].endSample;
    const nextStart =
      index === segments.length - 1 ? samples.length : segments[index + 1].startSample;
    const padStart = Math.min(paddingSamples, Math.floor((segment.startSample - previousEnd) / 2));
    const padEnd = Math.min(paddingSamples, Math.floor((nextStart - segment.endSample) / 2));
    const start = Math.max(0, segment.startSample - Math.max(0, padStart));
    const end = Math.min(samples.length, segment.endSample + Math.max(0, padEnd));
    bounds.push(...splitOversized({ samples, start, end, maxSegmentSamples, sampleRate }));
  }

  return mergeDanglingTail({
    bounds,
    totalSamples: samples.length,
    minTailSamples: Math.round(MIN_TAIL_SECONDS * sampleRate),
  });
}

function splitOversized(params: {
  samples: Float32Array;
  start: number;
  end: number;
  maxSegmentSamples: number;
  sampleRate: number;
}): ChunkBounds[] {
  const { samples, start, end, maxSegmentSamples, sampleRate } = params;
  const bounds: ChunkBounds[] = [];
  let cursor = start;
  while (end - cursor > maxSegmentSamples) {
    const cut = findQuietCut({
      samples,
      start: cursor,
      limit: cursor + maxSegmentSamples,
      sampleRate,
    });
    bounds.push({ start: cursor, end: cut });
    cursor = cut;
  }
  bounds.push({ start: cursor, end });
  return bounds;
}

/**
 * Cut before `limit` at the quietest window so a split lands in a pause rather
 * than inside a word.
 */
function findQuietCut(params: {
  samples: Float32Array;
  start: number;
  limit: number;
  sampleRate: number;
}): number {
  const { samples, start, limit, sampleRate } = params;
  const windowSamples = Math.round(SPLIT_WINDOW_SECONDS * sampleRate);
  const searchSamples = Math.round(SPLIT_SEARCH_SECONDS * sampleRate);
  const from = Math.max(start + windowSamples, limit - searchSamples);
  const step = Math.max(1, Math.floor(windowSamples / 2));

  let bestCut = limit;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let position = from; position + windowSamples <= limit; position += step) {
    const energy = rms(samples.subarray(position, position + windowSamples));
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestCut = position + Math.floor(windowSamples / 2);
    }
  }
  return bestCut;
}

function mergeDanglingTail(params: {
  bounds: ChunkBounds[];
  totalSamples: number;
  minTailSamples: number;
}): ChunkBounds[] {
  const { bounds, totalSamples, minTailSamples } = params;
  if (bounds.length === 0) {
    return bounds;
  }
  const last = bounds[bounds.length - 1];
  if (totalSamples - last.end < minTailSamples) {
    last.end = totalSamples;
  }
  return bounds;
}

function joinTranscripts(parts: string[]): string {
  const kept = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  let joined = "";
  for (const part of kept) {
    if (joined.length === 0) {
      joined = part;
      continue;
    }
    const previous = joined[joined.length - 1];
    const needsSpace = !CJK_PATTERN.test(previous) && !CJK_PATTERN.test(part[0]);
    joined = needsSpace ? `${joined} ${part}` : `${joined}${part}`;
  }
  return joined;
}

function peakAbs(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]);
    if (value > peak) {
      peak = value;
    }
  }
  return peak;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

function applyGain(samples: Float32Array, gain: number): Float32Array {
  if (gain === 1) {
    return samples;
  }
  const out = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    out[index] = Math.max(-1, Math.min(1, samples[index] * gain));
  }
  return out;
}
