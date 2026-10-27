"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "team_ai_configs",
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
          providerId: {
            type: Sequelize.STRING(64),
            allowNull: false,
          },
          baseUrl: {
            type: Sequelize.STRING(2048),
            allowNull: true,
          },
          apiKeyEncrypted: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          model: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          isDefault: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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
        "team_ai_configs",
        ["teamId", "providerId"],
        { unique: true, transaction }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("team_ai_configs", { transaction });
    });
  },
};
