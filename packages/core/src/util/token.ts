export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return Math.ceil(words + cjk / 1.5);
}
