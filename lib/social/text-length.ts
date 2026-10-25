import type { SocialPlatformCapabilities } from "./types";

// X の文字数の数え方（twitter-text の重み付きカウント）：
// U+0000〜U+10FF などの文字は 1、それ以外（日本語・絵文字など）は 2 として数え、上限 280。
// URL は長さに関係なく 23 として数える。絵文字の合成（ZWJ）は個別に数えるため、実際より多めに出ることがある（安全側）
const WEIGHT_ONE_RANGES: [number, number][] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
const URL_PATTERN = /https?:\/\/\S+/g;
const URL_WEIGHT = 23;

export function xWeightedLength(text: string): number {
  const normalized = text.normalize("NFC");
  let total = (normalized.match(URL_PATTERN) ?? []).length * URL_WEIGHT;
  for (const ch of normalized.replace(URL_PATTERN, "")) {
    const cp = ch.codePointAt(0) ?? 0;
    total += WEIGHT_ONE_RANGES.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return total;
}

// SNS の数え方での文字数
export function platformTextLength(text: string, capabilities: SocialPlatformCapabilities): number {
  const trimmed = text.trim();
  return capabilities.lengthCounting === "x-weighted" ? xWeightedLength(trimmed) : [...trimmed].length;
}
