import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type pino from "pino";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
  TranscriptionResult,
} from "../../../speech-provider.js";
import { parsePcm16MonoWav, parsePcmRateFromFormat } from "../../../audio.js";
import type { SherpaSttDecoder } from "./sherpa-stt-decoder.js";

export interface SherpaSttConfig {
  decoder: Pick<SherpaSttDecoder, "sampleRate" | "decode">;
}

export class SherpaOnnxStt implements SpeechToTextProvider {
  private readonly decoder: Pick<SherpaSttDecoder, "sampleRate" | "decode">;
  private readonly logger: pino.Logger;
  public readonly id = "local" as const;

  constructor(config: SherpaSttConfig, logger: pino.Logger) {
    this.decoder = config.decoder;
    this.logger = logger.child({ module: "speech", provider: "local", component: "stt" });
  }

  public createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    const emitter = new EventEmitter();
    const logger = params.logger.child({ provider: "local", component: "stt-session" });
    const requiredSampleRate = this.decoder.sampleRate;
    let connected = false;
    let segmentId = uuidv4();
    let previousSegmentId: string | null = null;
    let pcm16: Buffer = Buffer.alloc(0);

    return {
      requiredSampleRate,
      async connect() {
        connected = true;
      },
      appendPcm16(chunk: Buffer) {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }
        pcm16 = pcm16.length === 0 ? chunk : Buffer.concat([pcm16, chunk]);
      },
      commit: () => {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }

        const committedId = segmentId;
        const prev = previousSegmentId;
        const committedPcm16 = pcm16;
        previousSegmentId = committedId;
        segmentId = uuidv4();
        pcm16 = Buffer.alloc(0);
        emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });

        void (async () => {
          try {
            const rt = await this.transcribeAudio(
              committedPcm16,
              `audio/pcm;rate=${requiredSampleRate}`,
            );
            emitter.emit("transcript", {
              segmentId: committedId,
              transcript: rt.text,
              isFinal: true,
              language: rt.language,
              logprobs: rt.logprobs,
              avgLogprob: rt.avgLogprob,
              isLowConfidence: rt.isLowConfidence,
            });
          } catch (err) {
            emitter.emit("error", err);
          } finally {
            logger.debug({ bytes: committedPcm16.length }, "STT session reset");
          }
        })();
      },
      clear() {
        pcm16 = Buffer.alloc(0);
        segmentId = uuidv4();
      },
      close() {
        connected = false;
        pcm16 = Buffer.alloc(0);
      },
      on(event: "committed" | "transcript" | "error", handler: (payload: never) => void) {
        emitter.on(event, handler as (...args: unknown[]) => void);
        return undefined;
      },
    };
  }

  public async transcribeAudio(audioBuffer: Buffer, format: string): Promise<TranscriptionResult> {
    const start = Date.now();

    let inputRate: number;
    let pcm16: Buffer;
    if (format.toLowerCase().includes("audio/wav")) {
      const parsed = parsePcm16MonoWav(audioBuffer);
      inputRate = parsed.sampleRate;
      pcm16 = parsed.pcm16;
    } else if (format.toLowerCase().includes("audio/pcm")) {
      inputRate =
        parsePcmRateFromFormat(format, this.decoder.sampleRate) ?? this.decoder.sampleRate;
      pcm16 = audioBuffer;
    } else {
      throw new Error(`Unsupported audio format for local STT: ${format}`);
    }

    const result = this.decoder.decode(pcm16, inputRate);
    const duration = Date.now() - start;
    this.logger.debug({ duration, textLength: result.text.length }, "Local transcription complete");
    return {
      text: result.text,
      duration,
      ...(result.isLowConfidence ? { isLowConfidence: true } : {}),
    };
  }
}
