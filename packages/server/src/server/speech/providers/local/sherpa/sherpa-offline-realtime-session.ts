import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";

import type { StreamingTranscriptionSession } from "../../../speech-provider.js";
import type { SherpaSttDecoder } from "./sherpa-stt-decoder.js";

export class SherpaOfflineRealtimeTranscriptionSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  private readonly decoder: Pick<SherpaSttDecoder, "sampleRate" | "decode">;
  private connected = false;

  public readonly requiredSampleRate: number;
  private currentSegmentId: string | null = null;
  private previousSegmentId: string | null = null;
  private lastPartialText = "";

  private pcm16: Buffer = Buffer.alloc(0);
  private lastDecodeAt = 0;
  private decoding = false;
  private pendingDecode = false;
  private readonly minDecodeIntervalMs: number;

  constructor(params: {
    decoder: Pick<SherpaSttDecoder, "sampleRate" | "decode">;
    minDecodeIntervalMs?: number;
  }) {
    super();
    this.decoder = params.decoder;
    this.requiredSampleRate = this.decoder.sampleRate;
    this.minDecodeIntervalMs = params.minDecodeIntervalMs ?? 350;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.currentSegmentId = uuidv4();
    this.connected = true;
  }

  appendPcm16(chunk: Buffer): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Realtime transcription session not connected"));
      return;
    }

    try {
      this.pcm16 = this.pcm16.length === 0 ? chunk : Buffer.concat([this.pcm16, chunk]);
      void this.maybeDecode(false);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  commit(): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Realtime transcription session not connected"));
      return;
    }

    void (async () => {
      try {
        await this.maybeDecode(true);
        const finalText = this.lastPartialText;
        const segmentId = this.currentSegmentId!;
        const previousSegmentId = this.previousSegmentId;

        this.emit("committed", { segmentId, previousSegmentId });
        this.emit("transcript", { segmentId, transcript: finalText, isFinal: true });

        this.previousSegmentId = segmentId;
        this.currentSegmentId = uuidv4();
        this.lastPartialText = "";
        this.pcm16 = Buffer.alloc(0);
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  clear(): void {
    if (!this.connected) {
      return;
    }
    this.pcm16 = Buffer.alloc(0);
    this.currentSegmentId = uuidv4();
    this.lastPartialText = "";
  }

  close(): void {
    this.connected = false;
    this.currentSegmentId = null;
    this.pcm16 = Buffer.alloc(0);
  }

  private async maybeDecode(force: boolean): Promise<void> {
    if (!this.connected || !this.currentSegmentId) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastDecodeAt < this.minDecodeIntervalMs) {
      return;
    }

    if (this.decoding) {
      this.pendingDecode = true;
      return;
    }

    this.decoding = true;
    try {
      const text = await this.decodeNow();
      this.lastDecodeAt = Date.now();
      if (text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.emit("transcript", {
          segmentId: this.currentSegmentId,
          transcript: text,
          isFinal: false,
        });
      }
    } finally {
      this.decoding = false;
      if (this.pendingDecode) {
        this.pendingDecode = false;
        await this.maybeDecode(true);
      }
    }
  }

  private async decodeNow(): Promise<string> {
    if (this.pcm16.length === 0) {
      return "";
    }
    return this.decoder.decode(this.pcm16, this.decoder.sampleRate).text;
  }
}
