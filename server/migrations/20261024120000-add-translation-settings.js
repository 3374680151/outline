"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn("teams", "translationSettings", {
        type: Sequelize.JSONB,
        allowNull: true,
      }, { transaction });

      await queryInterface.addColumn("teams", "translationApiKey", {
        type: Sequelize.BLOB,
        allowNull: true,
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("teams", "translationApiKey", {
        transaction,
      });
      await queryInterface.removeColumn("teams", "translationSettings", {
        transaction,
      });
    });
  },
};
