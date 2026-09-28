import pino from "pino";
import { describe, expect, it } from "vitest";

import { SherpaSttDecoder, type SherpaSttDecoderEngine } from "./sherpa-stt-decoder.js";
import type { SherpaVadSegment, SherpaVadSegmentation } from "./sherpa-vad-segmenter.js";

const SAMPLE_RATE = 16000;
const logger = pino({ level: "silent" });

class FakeEngine implements SherpaSttDecoderEngine {
  public readonly sampleRate = SAMPLE_RATE;
  public readonly chunks: Float32Array[] = [];
  private readonly transcripts: string[];

  constructor(transcripts: string[] = ["transcript"]) {
    this.transcripts = transcripts;
  }

  readonly recognizer = {
    decode: (): void => undefined,
    getResult: (): { text: string } => {
      const index = Math.min(this.chunks.length - 1, this.transcripts.length - 1);
      return { text: this.transcripts[Math.max(0, index)] };
    },
  };

  createStream(): unknown {
    return {};
  }

  acceptWaveform(_stream: unknown, _sampleRate: number, samples: Float32Array): void {
    this.chunks.push(samples);
  }
}

class FakeSegmenter implements SherpaVadSegmentation {
  public readonly observedSamples: number[] = [];

  constructor(private readonly result: (samples: Float32Array) => SherpaVadSegment[]) {}

  segment(samples: Float32Array): SherpaVadSegment[] {
    this.observedSamples.push(samples.length);
    return this.result(samples);
  }
}

function tonePcm16(durationSeconds: number, sampleRate = SAMPLE_RATE): Buffer {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const pcm16 = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(10000 * Math.sin((2 * Math.PI * 220 * index) / sampleRate));
    pcm16.writeInt16LE(value, index * 2);
  }
  return pcm16;
}

describe("SherpaSttDecoder", () => {
  it("skips decoding for buffers below the silence peak threshold", () => {
    const engine = new FakeEngine();
    const decoder = new SherpaSttDecoder({ engine }, logger);

    expect(decoder.decode(Buffer.alloc(SAMPLE_RATE * 2), SAMPLE_RATE)).toEqual({
      text: "",
      isLowConfidence: true,
    });
    expect(engine.chunks).toHaveLength(0);
  });

  it("skips decoding when the VAD finds no speech", () => {
    const engine = new FakeEngine();
    const segmenter = new FakeSegmenter(() => []);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    expect(decoder.decode(tonePcm16(4), SAMPLE_RATE)).toEqual({
      text: "",
      isLowConfidence: true,
    });
    expect(segmenter.observedSamples).toEqual([4 * SAMPLE_RATE]);
    expect(engine.chunks).toHaveLength(0);
  });

  it("decodes short audio in a single pass", () => {
    const engine = new FakeEngine(["hello"]);
    const segmenter = new FakeSegmenter(() => [{ startSample: 16000, endSample: 64000 }]);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    expect(decoder.decode(tonePcm16(5), SAMPLE_RATE)).toEqual({
      text: "hello",
      isLowConfidence: false,
    });
    expect(engine.chunks.map((chunk) => chunk.length)).toEqual([5 * SAMPLE_RATE]);
  });

  it("decodes long audio per VAD segment with bounded padding", () => {
    const engine = new FakeEngine(["first", "second"]);
    const segmenter = new FakeSegmenter(() => [
      { startSample: 2 * SAMPLE_RATE, endSample: 15 * SAMPLE_RATE },
      { startSample: 20 * SAMPLE_RATE, endSample: 35 * SAMPLE_RATE },
    ]);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    const result = decoder.decode(tonePcm16(40), SAMPLE_RATE);

    expect(result).toEqual({ text: "first second", isLowConfidence: false });
    expect(engine.chunks.map((chunk) => chunk.length)).toEqual([220800, 252800]);
  });

  it("cuts oversized segments at the quietest window", () => {
    const engine = new FakeEngine(["first", "second"]);
    const segmenter = new FakeSegmenter((samples) => [
      { startSample: 0, endSample: samples.length },
    ]);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    const pcm16 = tonePcm16(40);
    pcm16.fill(0, 28 * SAMPLE_RATE * 2, Math.round(28.3 * SAMPLE_RATE) * 2);
    const result = decoder.decode(pcm16, SAMPLE_RATE);

    expect(result.text).toBe("first second");
    expect(engine.chunks.map((chunk) => chunk.length)).toEqual([448800, 191200]);
  });

  it("joins CJK segments without inserting spaces", () => {
    const engine = new FakeEngine(["第一段。", "第二段。"]);
    const segmenter = new FakeSegmenter(() => [
      { startSample: 0, endSample: 10 * SAMPLE_RATE },
      { startSample: 20 * SAMPLE_RATE, endSample: 35 * SAMPLE_RATE },
    ]);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    expect(decoder.decode(tonePcm16(40), SAMPLE_RATE).text).toBe("第一段。第二段。");
  });

  it("resamples input audio to the engine sample rate", () => {
    const engine = new FakeEngine(["resampled"]);
    const segmenter = new FakeSegmenter((samples) => [
      { startSample: 0, endSample: samples.length },
    ]);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    const result = decoder.decode(tonePcm16(5, 8000), 8000);

    expect(result.text).toBe("resampled");
    expect(segmenter.observedSamples).toHaveLength(1);
    expect(segmenter.observedSamples[0]).toBeGreaterThanOrEqual(5 * SAMPLE_RATE - 2);
    expect(segmenter.observedSamples[0]).toBeLessThanOrEqual(5 * SAMPLE_RATE);
    expect(engine.chunks.map((chunk) => chunk.length)).toEqual(segmenter.observedSamples);
  });

  it("keeps VAD-reported silence out of the model input", () => {
    const engine = new FakeEngine();
    const segmenter = new FakeSegmenter(() => []);
    const decoder = new SherpaSttDecoder({ engine, vad: { segmenter } }, logger);

    const quietNoise = Buffer.alloc(4 * SAMPLE_RATE * 2);
    for (let index = 0; index < quietNoise.length; index += 2) {
      quietNoise.writeInt16LE(index % 14 === 0 ? -600 : 600, index);
    }

    expect(decoder.decode(quietNoise, SAMPLE_RATE).text).toBe("");
    expect(engine.chunks).toHaveLength(0);
  });
});
