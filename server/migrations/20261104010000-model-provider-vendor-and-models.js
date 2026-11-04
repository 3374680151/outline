"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "team_model_providers",
        "vendor",
        { type: Sequelize.STRING(50), allowNull: true },
        { transaction }
      );

      await queryInterface.createTable(
        "team_model_provider_models",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          providerId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "team_model_providers",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          modelId: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          enabled: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          source: {
            type: Sequelize.STRING(10),
            allowNull: false,
            defaultValue: "auto",
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex(
        "team_model_provider_models",
        ["providerId", "modelId"],
        { unique: true, transaction }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("team_model_provider_models", {
        transaction,
      });
      await queryInterface.removeColumn("team_model_providers", "vendor", {
        transaction,
      });
    });
  },
};
