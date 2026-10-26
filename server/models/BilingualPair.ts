import type { InferAttributes, InferCreationAttributes } from "sequelize";
import { Op, type Transaction } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Default,
  Table,
  Unique,
} from "sequelize-typescript";
import Document from "./Document";
import Team from "./Team";
import ParanoidModel from "./base/ParanoidModel";
import type { BilingualBlockState } from "@shared/types/bilingual";

/**
 * A bilingual document pair: a source document (English, structure
 * authoritative) and a mirror target document (Chinese). Both documents are
 * regular Document rows; this table only holds the link and the per-block
 * translation state.
 */
@Table({ tableName: "bilingual_pairs", modelName: "bilingual_pair" })
class BilingualPair extends ParanoidModel<
  InferAttributes<BilingualPair>,
  Partial<InferCreationAttributes<BilingualPair>>
> {
  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  /** The source document (left pane, English, structure authoritative). */
  @BelongsTo(() => Document, "sourceDocumentId")
  sourceDocument: Document;

  @ForeignKey(() => Document)
  @Unique
  @Column(DataType.UUID)
  sourceDocumentId: string;

  /** The mirror document (right pane, Chinese). */
  @BelongsTo(() => Document, "targetDocumentId")
  targetDocument: Document;

  @ForeignKey(() => Document)
  @Unique
  @Column(DataType.UUID)
  targetDocumentId: string;

  /** ISO language code of the source document. */
  @Default("en")
  @Column(DataType.STRING(5))
  sourceLanguage: string;

  /** ISO language code of the mirror document. */
  @Default("zh")
  @Column(DataType.STRING(5))
  targetLanguage: string;

  /** Index-parallel translation state for each source document block. */
  @Default([])
  @Column(DataType.JSONB)
  blockStates: BilingualBlockState[];

  /**
   * Finds the pair a document belongs to, if any.
   *
   * @param documentId The document to look up, either side of a pair.
   * @param options Query options passed through to Sequelize.
   * @returns The pair containing the document, or null.
   */
  static async findForDocument(
    documentId: string,
    options?: { transaction?: Transaction | null }
  ): Promise<BilingualPair | null> {
    return this.findOne({
      where: {
        [Op.or]: [
          { sourceDocumentId: documentId },
          { targetDocumentId: documentId },
        ],
      },
      ...options,
    });
  }
}

export default BilingualPair;
