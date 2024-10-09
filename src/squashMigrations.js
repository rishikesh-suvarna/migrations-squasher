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
  .option('--models-dir <dir>', 'Models directory', 'models')
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

const loadModels = async () => {
  const models = {};

  const modelFiles = fs.readdirSync(modelsFolder).filter(file => (
    file.indexOf('.') !== 0 &&
    file !== 'index.js' &&
    file.slice(-3) === '.js' &&
    file.indexOf('.test.js') === -1
  ));

  for (const file of modelFiles) {
    const modelPath = path.join(modelsFolder, file);
    const model = require(modelPath)(sequelize, DataTypes);
    models[model.name] = model;
  }

  return models;
};
const generateMigration = async () => {
  const models = await loadModels();
  const migrationContents = [];

  for (const modelName in models) {
    const model = models[modelName];
    const tableSQL = await sequelize
      .getQueryInterface()
      .createTable(model.tableName, model.rawAttributes);
    migrationContents.push(tableSQL);
  }
};

generateMigration()
  .then(() => {
    console.log('Migration generation complete.');
    sequelize.close();
  })
  .catch((err) => {
    console.error('Error generating migration:', err);
    sequelize.close();
  });
