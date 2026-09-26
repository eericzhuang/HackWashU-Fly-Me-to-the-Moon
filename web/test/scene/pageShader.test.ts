import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Execute ff's arithmetic in Node so color-channel regressions can be checked without WebGL or scan files.
function flatFieldFromShader(sharp: number[], blur: number[]): number {
  const source = readFileSync(new URL("../../src/scene/page.ts", import.meta.url), "utf8");
  const expression = source.match(/float ff\(sampler2D t\) \{ return (.*); \}/)?.[1];
  if (!expression) throw new Error("ff shader expression not found");
  const js = expression
    .replaceAll("textureLod(t, vUv, sharpLod).rgb", "sharp")
    .replaceAll("textureLod(t, vUv, blurLod).rgb", "blur")
    .replaceAll("textureLod(t, vUv, sharpLod).r", "sharp[0]")
    .replaceAll("textureLod(t, vUv, blurLod).r", "blur[0]")
    .replaceAll("dot(sharp, vec3(1.0 / 3.0))", "mean(sharp)")
    .replaceAll("dot(blur, vec3(1.0 / 3.0))", "mean(blur)")
    .replaceAll("max(", "Math.max(");
  const evaluate = new Function("sharp", "blur", "mean", `return ${js};`) as (
    sharp: number[], blur: number[], mean: (channels: number[]) => number,
  ) => number;
  return evaluate(sharp, blur, (channels) => channels.reduce((sum, value) => sum + value, 0) / 3);
}

it("flat-fields red, green, blue, and grayscale measurements equally", () => {
  for (const channel of [0, 1, 2]) {
    const sharp = [0, 0, 0];
    const blur = [0, 0, 0];
    sharp[channel] = 0.6;
    blur[channel] = 0.5;
    expect(flatFieldFromShader(sharp, blur)).toBeCloseTo(1.2, 6);
  }
  expect(flatFieldFromShader([0.2, 0.2, 0.2], [0.25, 0.25, 0.25])).toBeCloseTo(0.8, 6);
});
