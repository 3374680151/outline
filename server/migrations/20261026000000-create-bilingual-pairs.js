"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "bilingual_pairs",
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
          sourceDocumentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "documents",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          targetDocumentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "documents",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          sourceLanguage: {
            type: Sequelize.STRING(5),
            allowNull: false,
            defaultValue: "en",
          },
          targetLanguage: {
            type: Sequelize.STRING(5),
            allowNull: false,
            defaultValue: "zh",
          },
          blockStates: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          deletedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex(
        "bilingual_pairs",
        ["teamId"],
        { transaction }
      );
      await queryInterface.addIndex(
        "bilingual_pairs",
        ["sourceDocumentId"],
        {
          unique: true,
          transaction,
        }
      );
      await queryInterface.addIndex(
        "bilingual_pairs",
        ["targetDocumentId"],
        {
          unique: true,
          transaction,
        }
      );
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("bilingual_pairs", { transaction });
    });
  },
};
