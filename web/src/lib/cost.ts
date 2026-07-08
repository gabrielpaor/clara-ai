// LLM cost estimation. Prices are env-configured (USD per MILLION
// tokens) so a model or price change is a config edit, not a deploy.
// Defaults are gemini-2.5-flash-lite paid-tier rates — on the free tier
// actual spend is $0, and this number answers the question a company
// actually asks: "what will this cost when we outgrow the free tier?"

const INPUT_PRICE_PER_MTOK = Number(process.env.LLM_INPUT_PRICE_PER_MTOK ?? 0.1);
const OUTPUT_PRICE_PER_MTOK = Number(process.env.LLM_OUTPUT_PRICE_PER_MTOK ?? 0.4);

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
}

/** Estimated USD cost for one LLM call, as a fixed-6 string (Decimal input). */
export function estimateCostUsd(usage: TokenUsage): string {
  const cost =
    (usage.promptTokens / 1_000_000) * INPUT_PRICE_PER_MTOK +
    (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK;
  return cost.toFixed(6);
}
