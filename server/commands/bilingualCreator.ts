import { InvalidRequestError } from "@server/errors";
import { BilingualPair, Document } from "@server/models";
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
 * Creates a bilingual pair: the source document (English, structure
 * authoritative) and a mirror target document (Chinese). The mirror is an
 * unattached draft that only lives inside the bilingual view; it can be
 * promoted to a regular document explicitly via the save actions.
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
  } else {
    source = await documentCreator(ctx, {
      title: props.title ?? "",
      collectionId: props.collectionId,
      parentDocumentId: props.parentDocumentId,
      publish: props.publish ?? false,
    });
  }

  // The mirror document is created as an unattached draft: it exists so the
  // collaborative mirror editor has a backing document, but it never appears
  // in collections or the sidebar. The bilingual view is the only surface it
  // lives on; "save as a standalone document" promotes it explicitly.
  const target = await documentCreator(ctx, {
    title: source.title,
    language: "zh",
    publish: false,
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
