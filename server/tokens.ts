/** Token estimation — UI must clearly label these as estimated. */
export function countTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars per token heuristic (labeled "estimated" in the UI)
  return Math.ceil(text.length / 4);
}

export function countTokensMessages(msgs: { content: string }[]): number {
  return msgs.reduce((a, m) => a + countTokens(m.content) + 4, 0);
}
