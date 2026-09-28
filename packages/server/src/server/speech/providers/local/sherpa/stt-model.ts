import { getSherpaSttModelSpec } from "./model-catalog.js";
import type { LocalSttModelId } from "../models.js";
import type { SherpaOfflineRecognizerModel } from "./sherpa-offline-recognizer.js";

export interface SherpaSttModel {
  engine: SherpaOfflineRecognizerModel;
  usesVad: boolean;
}

export function resolveSherpaSttModel(params: {
  modelId: LocalSttModelId;
  modelDir: string;
}): SherpaSttModel {
  const spec = getSherpaSttModelSpec(params.modelId);
  switch (spec.family) {
    case "nemo_transducer":
      return {
        engine: {
          kind: "nemo_transducer",
          encoder: `${params.modelDir}/encoder.int8.onnx`,
          decoder: `${params.modelDir}/decoder.int8.onnx`,
          joiner: `${params.modelDir}/joiner.int8.onnx`,
          tokens: `${params.modelDir}/tokens.txt`,
        },
        usesVad: false,
      };
    case "sense_voice":
      return {
        engine: {
          kind: "sense_voice",
          model: `${params.modelDir}/model.int8.onnx`,
          tokens: `${params.modelDir}/tokens.txt`,
          useInverseTextNormalization: true,
        },
        usesVad: true,
      };
  }
}
