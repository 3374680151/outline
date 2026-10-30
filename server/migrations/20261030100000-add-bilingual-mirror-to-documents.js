"use strict";

/**
 * Marks the mirror half of a bilingual pair. Mirror documents are editing
 * companions of their source document: they are not part of a collection and
 * must not appear in the global document lists (home, drafts, search).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "documents",
        "bilingualMirror",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction }
      );

      // Backfill existing pairs so mirrors created before the column existed
      // are hidden as well.
      await queryInterface.sequelize.query(
        `UPDATE documents SET "bilingualMirror" = true
         WHERE id IN (SELECT "targetDocumentId" FROM bilingual_pairs)`,
        { transaction }
      );

      await queryInterface.addIndex("documents", ["bilingualMirror"], {
        transaction,
      });
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("documents", ["bilingualMirror"], {
        transaction,
      });
      await queryInterface.removeColumn("documents", "bilingualMirror", {
        transaction,
      });
    });
  },
};
