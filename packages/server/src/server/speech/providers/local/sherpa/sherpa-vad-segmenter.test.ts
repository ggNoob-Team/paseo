import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { SherpaVadSegmenter, type SherpaVadModule } from "./sherpa-vad-segmenter.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface NativeSegment {
  start: number;
  samples: Float32Array;
}

class FakeVad {
  public readonly windows: Float32Array[] = [];
  public resetCount = 0;
  public flushCount = 0;
  private queue: NativeSegment[] = [];
  private acceptCount = 0;

  constructor(
    public readonly config: Record<string, unknown>,
    public readonly bufferSizeInSeconds: number,
    private readonly hooks: {
      onAccept?: (vad: FakeVad, acceptCount: number) => void;
      onFlush?: (vad: FakeVad) => void;
    } = {},
  ) {}

  acceptWaveform(samples: Float32Array): void {
    this.windows.push(samples);
    this.acceptCount += 1;
    this.hooks.onAccept?.(this, this.acceptCount);
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  front(): NativeSegment {
    return this.queue[0];
  }

  pop(): void {
    this.queue.shift();
  }

  flush(): void {
    this.flushCount += 1;
    this.hooks.onFlush?.(this);
  }

  reset(): void {
    this.resetCount += 1;
    this.acceptCount = 0;
    this.queue = [];
    this.windows.length = 0;
  }

  push(segment: NativeSegment): void {
    this.queue.push(segment);
  }
}

function createFakeVad(hooks?: {
  onAccept?: (vad: FakeVad, acceptCount: number) => void;
  onFlush?: (vad: FakeVad) => void;
}): { module: SherpaVadModule; vads: FakeVad[] } {
  const vads: FakeVad[] = [];
  return {
    vads,
    module: {
      Vad: class extends FakeVad {
        constructor(config: Record<string, unknown>, bufferSizeInSeconds: number) {
          super(config, bufferSizeInSeconds, hooks);
          vads.push(this);
        }
      },
    },
  };
}

function makeModelFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "paseo-vad-"));
  directories.push(directory);
  const modelPath = join(directory, "silero_vad.onnx");
  writeFileSync(modelPath, "");
  return modelPath;
}

const logger = pino({ level: "silent" });

describe("SherpaVadSegmenter", () => {
  it("feeds the configured windows and passes Silero settings to the native VAD", () => {
    const { module, vads } = createFakeVad();
    const modelPath = makeModelFile();
    const segmenter = new SherpaVadSegmenter(
      { modelPath, windowSize: 4, threshold: 0.4, bufferSeconds: 120 },
      logger,
      () => module,
    );

    expect(segmenter.segment(new Float32Array([1, 2, 3, 4, 5, 6]))).toEqual([]);

    const vad = vads[0];
    expect(vad.config).toEqual({
      sileroVad: {
        model: modelPath,
        threshold: 0.4,
        minSpeechDuration: 0.1,
        minSilenceDuration: 0.3,
        maxSpeechDuration: 20,
        windowSize: 4,
      },
      sampleRate: 16000,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    });
    expect(vad.bufferSizeInSeconds).toBe(120);
    expect(vad.flushCount).toBe(1);
  });

  it("zero-pads a trailing partial window instead of dropping it", () => {
    const { module, vads } = createFakeVad();
    const segmenter = new SherpaVadSegmenter(
      { modelPath: makeModelFile(), windowSize: 4 },
      logger,
      () => module,
    );

    segmenter.segment(new Float32Array([1, 2, 3, 4, 5, 6]));

    const windows = vads[0].windows.map((window) => Array.from(window));
    expect(windows).toEqual([
      [1, 2, 3, 4],
      [5, 6, 0, 0],
    ]);
  });

  it("returns detected speech ranges in order, including segments flushed at the end", () => {
    const { module } = createFakeVad({
      onAccept: (vad, acceptCount) => {
        if (acceptCount === 1) {
          vad.push({ start: 4, samples: new Float32Array(8) });
        }
      },
      onFlush: (vad) => {
        vad.push({ start: 32, samples: new Float32Array(16) });
      },
    });
    const segmenter = new SherpaVadSegmenter(
      { modelPath: makeModelFile(), windowSize: 4 },
      logger,
      () => module,
    );

    const segments = segmenter.segment(new Float32Array(64));

    expect(segments).toEqual([
      { startSample: 4, endSample: 12 },
      { startSample: 32, endSample: 48 },
    ]);
  });

  it("resets the native VAD before every call so segments do not leak across buffers", () => {
    const { module, vads } = createFakeVad({
      onAccept: (vad, acceptCount) => {
        if (acceptCount === 1) {
          vad.push({ start: 0, samples: new Float32Array(2) });
        }
      },
    });
    const segmenter = new SherpaVadSegmenter(
      { modelPath: makeModelFile(), windowSize: 4 },
      logger,
      () => module,
    );

    expect(segmenter.segment(new Float32Array(4))).toEqual([{ startSample: 0, endSample: 2 }]);
    expect(segmenter.segment(new Float32Array(4))).toEqual([{ startSample: 0, endSample: 2 }]);
    expect(vads[0].resetCount).toBe(2);
    expect(vads[0].windows).toHaveLength(1);
  });
});
