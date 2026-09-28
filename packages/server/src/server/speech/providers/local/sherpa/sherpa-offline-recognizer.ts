import { existsSync } from "node:fs";
import type pino from "pino";

import { loadSherpaOnnxNode, type SherpaOnnxNodeModule } from "./sherpa-onnx-node-loader.js";

function assertFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

export interface SherpaNemoTransducerModel {
  kind: "nemo_transducer";
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

export interface SherpaSenseVoiceModel {
  kind: "sense_voice";
  model: string;
  tokens: string;
  language?: string;
  useInverseTextNormalization?: boolean;
}

export type SherpaOfflineRecognizerModel = SherpaNemoTransducerModel | SherpaSenseVoiceModel;

export interface SherpaOfflineRecognizerConfig {
  model: SherpaOfflineRecognizerModel;
  numThreads?: number;
  provider?: "cpu";
  debug?: 0 | 1;
  sampleRate?: number;
  featureDim?: number;
  decodingMethod?: "greedy_search";
  maxActivePaths?: number;
}

interface SherpaOfflineRecognizerNative {
  config?: { featConfig?: { sampleRate?: number } };
  createStream: () => unknown;
  decode: (stream: unknown) => void;
  getResult: (stream: unknown) => { text?: string } | string | undefined;
  free?: () => void;
}

interface SherpaOfflineStreamNative {
  acceptWaveform: ((arg: { samples: Float32Array; sampleRate: number }) => void) &
    ((sampleRate: number, samples: Float32Array) => void);
  free?: () => void;
}

function assertModelFiles(model: SherpaOfflineRecognizerModel): void {
  switch (model.kind) {
    case "nemo_transducer":
      assertFileExists(model.encoder, "offline encoder");
      assertFileExists(model.decoder, "offline decoder");
      assertFileExists(model.joiner, "offline joiner");
      assertFileExists(model.tokens, "tokens");
      return;
    case "sense_voice":
      assertFileExists(model.model, "SenseVoice model");
      assertFileExists(model.tokens, "tokens");
  }
}

function buildModelConfig(params: {
  model: SherpaOfflineRecognizerModel;
  numThreads: number;
  provider: "cpu";
  debug: 0 | 1;
}): Record<string, unknown> {
  const shared = {
    numThreads: params.numThreads,
    provider: params.provider,
    debug: params.debug,
  };
  switch (params.model.kind) {
    case "nemo_transducer":
      return {
        transducer: {
          encoder: params.model.encoder,
          decoder: params.model.decoder,
          joiner: params.model.joiner,
        },
        tokens: params.model.tokens,
        modelType: "nemo_transducer",
        ...shared,
      };
    case "sense_voice":
      return {
        senseVoice: {
          model: params.model.model,
          ...(params.model.language ? { language: params.model.language } : {}),
          useInverseTextNormalization: params.model.useInverseTextNormalization === false ? 0 : 1,
        },
        tokens: params.model.tokens,
        ...shared,
      };
  }
}

export class SherpaOfflineRecognizerEngine {
  public readonly recognizer: SherpaOfflineRecognizerNative;
  public readonly sampleRate: number;
  private readonly logger: pino.Logger;

  constructor(
    config: SherpaOfflineRecognizerConfig,
    logger: pino.Logger,
    loadModule: () => SherpaOnnxNodeModule = loadSherpaOnnxNode,
  ) {
    this.logger = logger.child({
      module: "speech",
      provider: "local",
      component: "offline-recognizer",
    });

    assertModelFiles(config.model);

    const sherpa = loadModule();
    const numThreads = config.numThreads ?? 1;

    const recognizerConfig = {
      featConfig: {
        sampleRate: config.sampleRate ?? 16000,
        featureDim: config.featureDim ?? 80,
      },
      modelConfig: buildModelConfig({
        model: config.model,
        numThreads,
        provider: config.provider ?? "cpu",
        debug: config.debug ?? 0,
      }),
      ...(config.model.kind === "nemo_transducer"
        ? {
            decodingMethod: config.decodingMethod ?? "greedy_search",
            maxActivePaths: config.maxActivePaths ?? 4,
          }
        : {}),
    };

    this.recognizer = new (
      sherpa as unknown as {
        OfflineRecognizer: new (config: unknown) => SherpaOfflineRecognizerNative;
      }
    ).OfflineRecognizer(recognizerConfig);
    const sr = this.recognizer?.config?.featConfig?.sampleRate;
    this.sampleRate =
      typeof sr === "number" && Number.isFinite(sr) && sr > 0
        ? sr
        : recognizerConfig.featConfig.sampleRate;

    this.logger.info(
      {
        kind: config.model.kind,
        sampleRate: this.sampleRate,
        numThreads: recognizerConfig.modelConfig.numThreads,
      },
      "Sherpa offline recognizer initialized",
    );
  }

  createStream(): SherpaOfflineStreamNative {
    return this.recognizer.createStream() as SherpaOfflineStreamNative;
  }

  acceptWaveform(
    stream: SherpaOfflineStreamNative,
    sampleRate: number,
    samples: Float32Array,
  ): void {
    if (!stream || typeof stream.acceptWaveform !== "function") {
      throw new Error("Unexpected sherpa offline stream: missing acceptWaveform()");
    }

    // sherpa-onnx-node expects: acceptWaveform({ samples, sampleRate })
    // sherpa-onnx (WASM) expects: acceptWaveform(sampleRate, samples)
    if (stream.acceptWaveform.length <= 1) {
      stream.acceptWaveform({ samples, sampleRate });
    } else {
      stream.acceptWaveform(sampleRate, samples);
    }
  }

  free(): void {
    try {
      this.recognizer?.free?.();
    } catch (err) {
      this.logger.warn({ err }, "Failed to free sherpa offline recognizer");
    }
  }
}
