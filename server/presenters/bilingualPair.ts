import type BilingualPair from "@server/models/BilingualPair";
import type { BilingualPairDTO } from "@shared/types/bilingual";

/**
 * Presents a bilingual pair for API responses.
 *
 * @param pair The bilingual pair model.
 * @returns The serialized bilingual pair.
 */
export default function presentBilingualPair(
  pair: BilingualPair
): BilingualPairDTO {
  return {
    id: pair.id,
    sourceDocumentId: pair.sourceDocumentId,
    targetDocumentId: pair.targetDocumentId,
    sourceLanguage: pair.sourceLanguage,
    targetLanguage: pair.targetLanguage,
    blockStates: pair.blockStates ?? [],
    createdAt: pair.createdAt.toISOString(),
    updatedAt: pair.updatedAt.toISOString(),
  };
}
