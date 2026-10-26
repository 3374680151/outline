import type { NavigationNode } from "@shared/types";
import { InvalidRequestError } from "@server/errors";
import { BilingualPair, Collection, Document } from "@server/models";
import { authorize } from "@server/policies";
import type { APIContext } from "@server/types";
import documentCreator from "./documentCreator";

type Props = {
  /** An existing document to turn into the source of a bilingual pair. */
  documentId?: string;
  /** Title for a newly created source document. */
  title?: string;
  /** Collection to create the source document in. */
  collectionId?: string;
  /** Parent document to nest the source document under. */
  parentDocumentId?: string;
  /** Whether a newly created source document should be published. */
  publish?: boolean;
};

/**
 * Finds the index of a document within its sibling list in a collection
 * structure tree.
 *
 * @param documentId The document to locate.
 * @param nodes The collection document structure nodes to search.
 * @returns The zero-based sibling index, or -1 when not found.
 */
function findSiblingIndex(
  documentId: string,
  nodes: NavigationNode[]
): number {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (node.id === documentId) {
      return i;
    }

    const nested = node.children
      ? findSiblingIndex(documentId, node.children)
      : -1;

    if (nested >= 0) {
      return nested;
    }
  }

  return -1;
}

/**
 * Creates a bilingual pair: the source document (English, structure
 * authoritative) and a mirror target document (Chinese) with the same title
 * in the same location. When the source is published the mirror is published
 * directly after it in the collection structure.
 *
 * @param ctx the API context containing the acting user and transaction.
 * @param props Either an existing documentId to pair, or the fields for a
 * new source document.
 * @returns The created pair with both documents loaded.
 */
export default async function bilingualCreator(
  ctx: APIContext,
  props: Props
): Promise<{ pair: BilingualPair; source: Document; target: Document }> {
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;

  let source: Document;
  let siblingIndex = -1;

  if (props.documentId) {
    source = await Document.findByPk(props.documentId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "update", source);

    const existing = await BilingualPair.findForDocument(source.id, {
      transaction,
    });

    if (existing) {
      throw InvalidRequestError(
        "Document is already part of a bilingual pair"
      );
    }

    if (source.publishedAt && source.collectionId) {
      const collection = await Collection.findByPk(source.collectionId, {
        includeDocumentStructure: true,
        transaction,
      });
      siblingIndex = collection?.documentStructure
        ? findSiblingIndex(source.id, collection.documentStructure)
        : -1;
    }
  } else {
    source = await documentCreator(ctx, {
      title: props.title ?? "",
      collectionId: props.collectionId,
      parentDocumentId: props.parentDocumentId,
      publish: props.publish ?? false,
    });
  }

  const target = await documentCreator(ctx, {
    title: source.title,
    collectionId: source.collectionId ?? undefined,
    parentDocumentId: source.parentDocumentId ?? undefined,
    language: "zh",
    publish: !!source.publishedAt,
    ...(siblingIndex >= 0 ? { index: siblingIndex + 1 } : {}),
  });

  const pair = await BilingualPair.create(
    {
      teamId: user.teamId,
      sourceDocumentId: source.id,
      targetDocumentId: target.id,
      sourceLanguage: "en",
      targetLanguage: "zh",
      blockStates: [],
    },
    { transaction }
  );

  return { pair, source, target };
}
