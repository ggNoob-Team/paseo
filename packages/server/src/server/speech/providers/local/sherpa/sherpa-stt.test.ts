import { describe, expect, it } from "vitest";
import pino from "pino";

import { SherpaOnnxStt } from "./sherpa-stt.js";
import type { TranscriptionResult } from "../../../speech-provider.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const idleDecoder = {
  sampleRate: 16000,
  decode: () => ({ text: "", isLowConfidence: true }),
};

class TestSherpaOnnxStt extends SherpaOnnxStt {
  public readonly calls: Array<{ audio: Buffer; format: string }> = [];
  public readonly pending: Array<ReturnType<typeof createDeferred<TranscriptionResult>>> = [];

  constructor() {
    super({ decoder: idleDecoder }, pino({ level: "silent" }));
  }

  override async transcribeAudio(
    audioBuffer: Buffer,
    format: string,
  ): Promise<TranscriptionResult> {
    this.calls.push({ audio: Buffer.from(audioBuffer), format });
    const deferred = createDeferred<TranscriptionResult>();
    this.pending.push(deferred);
    return deferred.promise;
  }
}

function wavBuffer(pcm16: Buffer, sampleRate: number): Buffer {
  const wav = Buffer.alloc(44 + pcm16.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm16.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm16.length, 40);
  pcm16.copy(wav, 44);
  return wav;
}

describe("SherpaOnnxStt session", () => {
  it("snapshots segment ids and buffers before async transcription starts", async () => {
    const provider = new TestSherpaOnnxStt();
    const session = provider.createSession({
      logger: pino({ level: "silent" }),
      language: "en",
    });

    const committed: Array<{ segmentId: string; previousSegmentId: string | null }> = [];
    const transcripts: Array<{ segmentId: string; transcript: string; isFinal: boolean }> = [];

    session.on("committed", (payload) => {
      committed.push(payload);
    });
    session.on("transcript", (payload) => {
      transcripts.push(payload);
    });

    await session.connect();

    session.appendPcm16(Buffer.from([1, 2, 3, 4]));
    session.commit();
    session.appendPcm16(Buffer.from([5, 6, 7, 8]));
    session.commit();

    expect(committed).toHaveLength(2);
    expect(committed[1]?.segmentId).not.toBe(committed[0]?.segmentId);
    expect(committed[0]?.previousSegmentId).toBeNull();
    expect(committed[1]?.previousSegmentId).toBe(committed[0]?.segmentId);

    expect(provider.calls).toEqual([
      { audio: Buffer.from([1, 2, 3, 4]), format: "audio/pcm;rate=16000" },
      { audio: Buffer.from([5, 6, 7, 8]), format: "audio/pcm;rate=16000" },
    ]);

    provider.pending[0]?.resolve({ text: "first", duration: 1 });
    provider.pending[1]?.resolve({ text: "second", duration: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcripts).toHaveLength(2);
    expect(transcripts).toEqual([
      expect.objectContaining({
        segmentId: committed[0].segmentId,
        transcript: "first",
        isFinal: true,
      }),
      expect.objectContaining({
        segmentId: committed[1].segmentId,
        transcript: "second",
        isFinal: true,
      }),
    ]);
  });
});

describe("SherpaOnnxStt transcription", () => {
  it("decodes PCM audio at the rate from the format string", async () => {
    const calls: Array<{ pcm16: Buffer; inputRate: number }> = [];
    const provider = new SherpaOnnxStt(
      {
        decoder: {
          sampleRate: 16000,
          decode: (pcm16, inputRate) => {
            calls.push({ pcm16: Buffer.from(pcm16), inputRate });
            return { text: "hello", isLowConfidence: false };
          },
        },
      },
      pino({ level: "silent" }),
    );

    const result = await provider.transcribeAudio(Buffer.from([1, 0, 2, 0]), "audio/pcm;rate=8000");

    expect(result.text).toBe("hello");
    expect(result.isLowConfidence).toBeUndefined();
    expect(calls).toEqual([{ pcm16: Buffer.from([1, 0, 2, 0]), inputRate: 8000 }]);
  });

  it("parses WAV input before decoding", async () => {
    const calls: Array<{ inputRate: number; bytes: number }> = [];
    const provider = new SherpaOnnxStt(
      {
        decoder: {
          sampleRate: 16000,
          decode: (pcm16, inputRate) => {
            calls.push({ inputRate, bytes: pcm16.length });
            return { text: "wav", isLowConfidence: false };
          },
        },
      },
      pino({ level: "silent" }),
    );

    const pcm16 = Buffer.from([1, 0, 2, 0, 3, 0]);
    const result = await provider.transcribeAudio(wavBuffer(pcm16, 22050), "audio/wav");

    expect(result.text).toBe("wav");
    expect(calls).toEqual([{ inputRate: 22050, bytes: pcm16.length }]);
  });

  it("reports silence as low confidence", async () => {
    const provider = new SherpaOnnxStt({ decoder: idleDecoder }, pino({ level: "silent" }));

    const result = await provider.transcribeAudio(Buffer.from([0, 0]), "audio/pcm;rate=16000");

    expect(result).toEqual({
      text: "",
      duration: expect.any(Number),
      isLowConfidence: true,
    });
  });

  it("rejects unsupported audio formats", async () => {
    const provider = new SherpaOnnxStt({ decoder: idleDecoder }, pino({ level: "silent" }));

    await expect(provider.transcribeAudio(Buffer.from([1, 2]), "audio/mpeg")).rejects.toThrow(
      "Unsupported audio format for local STT: audio/mpeg",
    );
  });
});
