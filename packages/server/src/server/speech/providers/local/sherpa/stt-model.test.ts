import { describe, expect, it } from "vitest";

import { LOCAL_STT_MODEL_IDS, getSherpaSttModelSpec } from "./model-catalog.js";
import { resolveSherpaSttModel } from "./stt-model.js";

describe("resolveSherpaSttModel", () => {
  it("builds NeMo transducer paths without VAD for Parakeet", () => {
    const model = resolveSherpaSttModel({
      modelId: "parakeet-tdt-0.6b-v2-int8",
      modelDir: "/models/parakeet",
    });

    expect(model).toEqual({
      engine: {
        kind: "nemo_transducer",
        encoder: "/models/parakeet/encoder.int8.onnx",
        decoder: "/models/parakeet/decoder.int8.onnx",
        joiner: "/models/parakeet/joiner.int8.onnx",
        tokens: "/models/parakeet/tokens.txt",
      },
      usesVad: false,
    });
  });

  it("builds SenseVoice with inverse text normalization and VAD", () => {
    const model = resolveSherpaSttModel({
      modelId: "sense-voice-zh-en-ja-ko-yue-int8",
      modelDir: "/models/sense-voice",
    });

    expect(model).toEqual({
      engine: {
        kind: "sense_voice",
        model: "/models/sense-voice/model.int8.onnx",
        tokens: "/models/sense-voice/tokens.txt",
        useInverseTextNormalization: true,
      },
      usesVad: true,
    });
  });

  it("references exactly the files the catalog declares", () => {
    for (const modelId of LOCAL_STT_MODEL_IDS) {
      const spec = getSherpaSttModelSpec(modelId);
      const model = resolveSherpaSttModel({ modelId, modelDir: "/models" });
      const referenced = Object.entries(model.engine)
        .filter(([key]) => key !== "kind" && key !== "useInverseTextNormalization")
        .map(([, value]) => String(value).replace("/models/", ""));

      expect(referenced.sort()).toEqual([...spec.requiredFiles].sort());
    }
  });
});
