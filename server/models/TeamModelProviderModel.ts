import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
  Unique,
} from "sequelize-typescript";
import IdModel from "./base/IdModel";
import TeamModelProvider from "./TeamModelProvider";

/**
 * One model of a workspace model provider. Rows come from an upstream sync
 * ("auto") or manual entry ("manual"); unchecking a model disables it
 * without deleting the row so usage history stays readable.
 */
@Table({
  tableName: "team_model_provider_models",
  modelName: "team_model_provider_model",
})
class TeamModelProviderModel extends IdModel<
  InferAttributes<TeamModelProviderModel>,
  Partial<InferCreationAttributes<TeamModelProviderModel>>
> {
  @BelongsTo(() => TeamModelProvider, "providerId")
  provider: TeamModelProvider;

  @ForeignKey(() => TeamModelProvider)
  @Column(DataType.UUID)
  providerId: string;

  /** The upstream model identifier. */
  @Column(DataType.STRING(255))
  modelId: string;

  /** Whether this model may serve requests. */
  @Default(true)
  @Column(DataType.BOOLEAN)
  enabled: boolean;

  /** Where the row came from: auto (upstream sync) or manual (typed in). */
  @Default("auto")
  @Column(DataType.STRING(10))
  source: string;
}

export default TeamModelProviderModel;
