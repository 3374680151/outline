/**
 * Splits text into chunks bounded by Unicode code points, preferring line and
 * sentence boundaries so paragraphs and sentences are not cut mid-thought.
 * Line breaks and punctuation stay attached to the preceding chunk, so
 * joining the chunks with the empty string restores the original text.
 *
 * @param text The text to split.
 * @param budget The maximum number of code points per chunk.
 * @returns The chunks, in order.
 */
export function chunkByCodepoints(text: string, budget: number): string[] {
  const characters = Array.from(text);

  if (characters.length <= budget) {
    return [text];
  }

  const chunks: string[] = [];
  let current: string[] = [];

  for (const segment of splitSegments(text, budget)) {
    if (current.length + segment.length <= budget) {
      current.push(...segment);
      continue;
    }

    if (current.length > 0) {
      chunks.push(current.join(""));
      current = [];
    }
    current = segment;
  }

  if (current.length > 0) {
    chunks.push(current.join(""));
  }

  return chunks;
}

/**
 * Splits text into segments of at most the given budget, preferring line
 * breaks, then sentence punctuation, then a hard cut.
 *
 * @param text The text to split.
 * @param budget The maximum number of code points per segment.
 * @returns The segments, each represented as an array of code points.
 */
function splitSegments(text: string, budget: number): string[][] {
  const segments: string[][] = [];

  for (const line of text.split(/(?<=\n)/u)) {
    const lineCharacters = Array.from(line);

    if (lineCharacters.length <= budget) {
      segments.push(lineCharacters);
      continue;
    }

    for (const sentence of line.split(/(?<=[。！？.!?；;])\s*/u)) {
      const sentenceCharacters = Array.from(sentence);

      if (sentenceCharacters.length <= budget) {
        segments.push(sentenceCharacters);
        continue;
      }

      for (let i = 0; i < sentenceCharacters.length; i += budget) {
        segments.push(sentenceCharacters.slice(i, i + budget));
      }
    }
  }

  return segments;
}
