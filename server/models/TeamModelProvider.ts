import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Team from "./Team";
import IdModel from "./base/IdModel";

/**
 * A model gateway configured by a workspace admin, e.g. a DeepSeek or
 * Anthropic endpoint used for translation and proofreading. One row is one
 * provider; credentials are encrypted at rest and never leave the server.
 */
@Table({ tableName: "team_model_providers", modelName: "team_model_provider" })
class TeamModelProvider extends IdModel<
  InferAttributes<TeamModelProvider>,
  Partial<InferCreationAttributes<TeamModelProvider>>
> {
  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  /** The display name chosen by the admin. */
  @Column(DataType.STRING(100))
  name: string;

  /** The vendor template slug this provider came from, when any. */
  @Column(DataType.STRING(50))
  vendor: string | null;

  /** The wire protocol, one of openai | anthropic | gemini. */
  @Column(DataType.STRING(20))
  protocol: string;

  /** The endpoint base URL. */
  @Column(DataType.STRING(2048))
  baseUrl: string;

  /** The encrypted API key. */
  @Column(DataType.TEXT)
  apiKeyEncrypted: string | null;

  /** The last characters of the key, for display only. */
  @Column(DataType.STRING(8))
  keyHint: string | null;

  /** The default model name used when no explicit model is requested. */
  @Column(DataType.STRING(255))
  model: string | null;

  /** Whether this provider may serve requests. */
  @Default(true)
  @Column(DataType.BOOLEAN)
  enabled: boolean;

  /**
   * Lists the enabled model providers of a workspace, oldest first.
   *
   * @param teamId The workspace to look up.
   * @returns The enabled providers.
   */
  static async listEnabled(teamId: string): Promise<TeamModelProvider[]> {
    return TeamModelProvider.findAll({
      where: {
        teamId,
        enabled: true,
      },
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
    });
  }
}

export default TeamModelProvider;
