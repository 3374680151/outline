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
import Model from "./base/Model";

/**
 * Workspace level AI service configuration, e.g. the OpenAI-compatible
 * endpoint used for translation or the LanguageTool server used for grammar
 * checking. Credentials are encrypted at rest and never leave the server;
 * only workspace admins may read or write this configuration.
 */
@Table({ tableName: "team_ai_configs", modelName: "team_ai_config" })
class TeamAiConfig extends Model<
  InferAttributes<TeamAiConfig>,
  Partial<InferCreationAttributes<TeamAiConfig>>
> {
  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  /** The service this configuration belongs to, e.g. "openai-compatible". */
  @Column(DataType.STRING(64))
  providerId: string;

  /** Override of the service base URL, when the service accepts one. */
  @Column(DataType.STRING(2048))
  baseUrl: string | null;

  /** The encrypted API key for the service. */
  @Column(DataType.TEXT)
  apiKeyEncrypted: string | null;

  /** The model name used by the service, when applicable. */
  @Column(DataType.STRING(255))
  model: string | null;

  /** Whether this provider is the workspace's preferred provider. */
  @Default(false)
  @Column(DataType.BOOLEAN)
  isDefault: boolean;

  /**
   * Finds every AI configuration of a team.
   *
   * @param teamId The team to look up.
   * @returns The configurations indexed by provider id.
   */
  static async mapForTeam(teamId: string): Promise<Map<string, TeamAiConfig>> {
    const rows = await TeamAiConfig.findAll({ where: { teamId } });
    return new Map(rows.map((row) => [row.providerId, row]));
  }
}

export default TeamAiConfig;
