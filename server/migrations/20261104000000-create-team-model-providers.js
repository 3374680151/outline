"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "team_model_providers",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          name: {
            type: Sequelize.STRING(100),
            allowNull: false,
          },
          protocol: {
            type: Sequelize.STRING(20),
            allowNull: false,
            defaultValue: "openai",
          },
          baseUrl: {
            type: Sequelize.STRING(2048),
            allowNull: false,
          },
          apiKeyEncrypted: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          keyHint: {
            type: Sequelize.STRING(8),
            allowNull: true,
          },
          model: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          enabled: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
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

      await queryInterface.addIndex("team_model_providers", ["teamId"], {
        transaction,
      });
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("team_model_providers", { transaction });
    });
  },
};
