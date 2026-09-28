import { existsSync } from "node:fs";

import type pino from "pino";

import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.js";

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_WINDOW_SIZE = 512;
const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_MIN_SPEECH_SECONDS = 0.1;
const DEFAULT_MIN_SILENCE_SECONDS = 0.3;
const DEFAULT_MAX_SPEECH_SECONDS = 20;
const DEFAULT_BUFFER_SECONDS = 600;

export interface SherpaVadSegment {
  startSample: number;
  endSample: number;
}

export interface SherpaVadSegmentation {
  segment(samples: Float32Array): SherpaVadSegment[];
}

export interface SherpaVadSegmenterConfig {
  modelPath: string;
  sampleRate?: number;
  threshold?: number;
  minSpeechSeconds?: number;
  minSilenceSeconds?: number;
  maxSpeechSeconds?: number;
  windowSize?: number;
  bufferSeconds?: number;
}

interface SherpaVadNativeSegment {
  start: number;
  samples: Float32Array;
}

interface SherpaVadHandle {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  flush(): void;
  front(): SherpaVadNativeSegment;
  pop(): void;
  reset(): void;
}

export interface SherpaVadModule {
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVadHandle;
}

function loadVadModule(): SherpaVadModule {
  return loadSherpaOnnxNode() as unknown as SherpaVadModule;
}

/**
 * Batch voice-activity segmentation over a complete audio buffer.
 *
 * Silence gating and long-audio splitting both need speech boundaries that the
 * streaming turn-detection session does not expose, so this runs Silero VAD
 * over a finished buffer and returns where speech actually is.
 */
export class SherpaVadSegmenter implements SherpaVadSegmentation {
  private readonly vad: SherpaVadHandle;
  private readonly windowSize: number;

  constructor(
    config: SherpaVadSegmenterConfig,
    logger: pino.Logger,
    loadModule: () => SherpaVadModule = loadVadModule,
  ) {
    if (!existsSync(config.modelPath)) {
      throw new Error(`Missing Silero VAD model: ${config.modelPath}`);
    }

    const sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;

    const sherpa = loadModule();
    this.vad = new sherpa.Vad(
      {
        sileroVad: {
          model: config.modelPath,
          threshold: config.threshold ?? DEFAULT_THRESHOLD,
          minSpeechDuration: config.minSpeechSeconds ?? DEFAULT_MIN_SPEECH_SECONDS,
          minSilenceDuration: config.minSilenceSeconds ?? DEFAULT_MIN_SILENCE_SECONDS,
          maxSpeechDuration: config.maxSpeechSeconds ?? DEFAULT_MAX_SPEECH_SECONDS,
          windowSize: this.windowSize,
        },
        sampleRate,
        numThreads: 1,
        provider: "cpu",
        debug: 0,
      },
      config.bufferSeconds ?? DEFAULT_BUFFER_SECONDS,
    );

    logger
      .child({ module: "speech", provider: "local", component: "vad-segmenter" })
      .debug({ modelPath: config.modelPath, sampleRate }, "Silero VAD segmenter initialized");
  }

  segment(samples: Float32Array): SherpaVadSegment[] {
    const segments: SherpaVadSegment[] = [];
    const drain = (): void => {
      while (!this.vad.isEmpty()) {
        const segment = this.vad.front();
        segments.push({
          startSample: segment.start,
          endSample: segment.start + segment.samples.length,
        });
        this.vad.pop();
      }
    };

    this.vad.reset();
    for (let offset = 0; offset < samples.length; offset += this.windowSize) {
      const window = samples.subarray(offset, offset + this.windowSize);
      this.vad.acceptWaveform(
        window.length < this.windowSize ? padWindow(window, this.windowSize) : window,
      );
      drain();
    }
    this.vad.flush();
    drain();
    return segments;
  }
}

function padWindow(window: Float32Array, windowSize: number): Float32Array {
  const padded = new Float32Array(windowSize);
  padded.set(window);
  return padded;
}
