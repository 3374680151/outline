import type { ProsemirrorData, ProsemirrorDoc } from "@shared/types";
import type BilingualPair from "@server/models/BilingualPair";
import { Document } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import documentCreator from "./documentCreator";

type Props = {
  /** The bilingual pair to export. */
  pair: BilingualPair;
  /** Title for the merged document, defaults to the source title. */
  title?: string;
  /** Collection to place the merged document in, defaults to the source's. */
  collectionId?: string | null;
  /** Whether the merged document should be published. */
  publish?: boolean;
};

/** Minimal structural type of a ProseMirror node in stored content JSON. */
interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
}

/**
 * Extracts the plain text of a ProseMirror node.
 *
 * @param node The node to read.
 * @returns The concatenated text content.
 */
function textOf(node: PMNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  return (node.content ?? []).map(textOf).join("");
}

/**
 * Builds a blockquote node wrapping a plain text translation.
 *
 * @param text The translated text.
 * @returns The blockquote node, or null when the text is empty.
 */
function translationBlock(text: string): PMNode | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  return {
    type: "blockquote",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed }],
      },
    ],
  };
}

/**
 * Interleaves the source and mirror documents into one bilingual document:
 * every source block is followed by its translated block rendered as a
 * blockquote. Blocks without a translation are passed through unchanged and
 * non-text blocks (images, code, tables) are never duplicated.
 *
 * @param source The source document content.
 * @param target The mirror document content.
 * @returns The merged document content.
 */
export function mergeBilingualContent(
  source: ProsemirrorData | null,
  target: ProsemirrorData | null
): ProsemirrorDoc {
  const sourceChildren = ((source as ProsemirrorDoc | null)?.content ??
    []) as unknown as PMNode[];
  const targetChildren = (target?.content ?? []) as unknown as PMNode[];
  const children: PMNode[] = [];

  for (let i = 0; i < sourceChildren.length; i++) {
    const sourceBlock = sourceChildren[i];
    children.push(sourceBlock);

    const targetBlock = targetChildren[i];

    if (!targetBlock) {
      continue;
    }

    const mirrorable =
      sourceBlock.type === "paragraph" || sourceBlock.type === "heading";
    const text = textOf(targetBlock).trim();

    if (!mirrorable || !text) {
      continue;
    }

    const translated = translationBlock(text);

    if (translated) {
      children.push(translated);
    }
  }

  return { type: "doc", content: children } as unknown as ProsemirrorDoc;
}

/**
 * Saves a bilingual pair as a single merged document: source content with
 * each block followed by its Chinese translation as a quote block. The
 * merged document is an independent document, unlinked from the pair.
 *
 * @param ctx the API context containing the acting user and transaction.
 * @param props The pair to export plus placement options.
 * @returns The created document.
 */
export default async function bilingualMergeExporter(
  ctx: APIContext,
  props: Props
): Promise<Document> {
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;
  const { pair } = props;

  const source = await Document.findByPk(pair.sourceDocumentId, {
    userId: user.id,
    transaction,
    rejectOnEmpty: true,
  });
  authorize(user, "update", source);

  const target = await Document.findByPk(pair.targetDocumentId, {
    userId: user.id,
    transaction,
    rejectOnEmpty: false,
  });

  const merged = mergeBilingualContent(source.content, target?.content ?? null);

  return documentCreator(ctx, {
    title: props.title ?? source.title,
    content: merged,
    collectionId:
      props.collectionId !== undefined
        ? props.collectionId
        : (source.collectionId ?? undefined),
    publish: props.publish ?? false,
  });
}
