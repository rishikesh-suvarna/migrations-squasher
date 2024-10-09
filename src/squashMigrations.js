#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

program
  .option('-t, --db-dialect <dialect>', 'Database Dialect', 'postgres')
  .option('-d, --db-name <name>', 'Database name')
  .option('-u, --db-user <user>', 'Database username')
  .option('-p, --db-pass <pass>', 'Database password', '')
  .option('--db-host <host>', 'Database host', 'localhost')
  .option('--models-dir <dir>', 'Models directory', './models')
  .option('--out-dir <dir>', 'Output directory', './migrations')
  .parse(process.argv);

const options = program.opts();

const sequelize = new Sequelize(
  options.dbName,
  options.dbUser,
  options.dbPass,
  {
    host: options.dbHost,
    dialect: options.dbDialect,
    logging: false,
  }
);

const modelsFolder = path.join(process.cwd(), options.modelsDir);
const outputFilePath = `${options.outDir}/${new Date().getTime()}-squashed-migrations.js`;

const loadModels = async () => {
  const models = {};

  const modelFiles = fs
    .readdirSync(modelsFolder)
    .filter(
      (file) =>
        file.indexOf('.') !== 0 &&
        file !== 'index.js' &&
        file.slice(-3) === '.js' &&
        file.indexOf('.test.js') === -1
    );

  for (const file of modelFiles) {
    const modelPath = path.join(modelsFolder, file);
    const model = require(modelPath)(sequelize, DataTypes);
    models[model.name] = model;
  }

  return models;
};

const generateTableAttributes = (attributes) => {
  const result = {};

  for (const [key, value] of Object.entries(attributes)) {
    // * SKIP IF THIS IS A VIRTUAL FIELD
    if (value.type._isSequelizeMethod) continue;

    result[key] = {
      ...value,
      type: value.type.toString(), // * CONVERT THE DATATYPE TO STRING REPRESENTATION
    };
  }

  return result;
};

const generateMigration = async () => {
  const models = await loadModels();
  const migrationStatements = [];

  // * ENSURE MIGRATIONS DIRECTORY EXISTS
  const migrationsDir = path.dirname(outputFilePath);
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  // * FIRST, CREATE ALL TABLES
  for (const modelName in models) {
    const model = models[modelName];
    const attributes = generateTableAttributes(model.rawAttributes);

    migrationStatements.push(`
      // Create ${model.tableName} table
      await queryInterface.createTable('${model.tableName}', ${JSON.stringify(
      attributes,
      null,
      2
    )});
    `);
  }

  const output = `
    'use strict';
    module.exports = {
      up: async (queryInterface, Sequelize) => {
        ${migrationStatements.join('\n\n')}
      },

      down: async (queryInterface, Sequelize) => {
        ${Object.keys(models)
          .reverse() // * DROP TABLES IN REVERSE ORDER TO AVOID FOREIGH KEY ERRORS
          .map(
            (modelName) =>
              `await queryInterface.dropTable('${models[modelName].tableName}');`
          )
          .join('\n\n')}
      }
    };
`;

  // * OUTPUT THE MIGRATION TO FILE
  fs.writeFileSync(outputFilePath, output);
  console.log(`Fresh migration created at ${outputFilePath}`);
};

// * RUN THE GENERATE MIGRATION FUNCTION
generateMigration()
  .then(() => {
    console.log('Migration generation complete.');
    sequelize
      .close()
      .then(() => {
        console.log('Sequelize connection closed.');
        process.exit(0);
      })
      .catch((err) => {
        console.error('Error closing Sequelize connection:', err);
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error('Error generating migration:', err);
    process.exit(1);
  });
