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
const outputFilePath = `${
  options.outDir
}/${new Date().getTime()}-squashed-migrations.js`;

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

const typeMapping = {
  DOUBLE: 'DOUBLE',
  'DOUBLE PRECISION': 'DOUBLE',
  REAL: 'REAL',
  FLOAT: 'FLOAT',
  DECIMAL: 'DECIMAL',
  INTEGER: 'INTEGER',
  BIGINT: 'BIGINT',
  SMALLINT: 'SMALLINT',
  ENUM: 'ENUM',
  STRING: 'STRING',
  VARCHAR: 'STRING',
  TEXT: 'TEXT',
  DATE: 'DATE',
  DATETIME: 'DATE',
  BOOLEAN: 'BOOLEAN',
  UUID: 'UUID',
  JSON: 'JSON',
  JSONB: 'JSONB',
};

const getSequelizeType = (sequelizeType) => {
  if (!sequelizeType) {
    console.error('ENCOUNTERED UNDEFINED SEQUELIZE TYPE');
    return 'STRING'; // * DEFAULT FALLBACK TYPE
  }

  try {
    const typeString = sequelizeType.toString();
    const baseType = typeString.split('(')[0];
    return typeMapping[baseType] || typeString;
  } catch (error) {
    console.error('ERROR PROCESSING SEQUELIZE TYPE:', error);
    return 'STRING'; // * DEFAULT FALLBACK TYPE
  }
};

const generateEnumTypes = (models) => {
  const enumTypes = new Set();
  const enumCreationStatements = [];

  for (const model of Object.values(models)) {
    for (const [fieldName, attribute] of Object.entries(model.rawAttributes)) {
      if (attribute.type instanceof DataTypes.ENUM) {
        const enumTypeName = `enum_${model.tableName}_${fieldName}`;
        const enumValues = attribute.values
          .map((value) => `'${value}'`)
          .join(', ');

        if (!enumTypes.has(enumTypeName)) {
          enumTypes.add(enumTypeName);
          enumCreationStatements.push(`
            await queryInterface.sequelize.query(\`
              DO $$
              BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumTypeName}') THEN
                  CREATE TYPE "${enumTypeName}" AS ENUM (${enumValues});
                END IF;
              END
              $$;\`);
          `);
        }
      }
    }
  }

  return enumCreationStatements;
};

const generateTableAttributes = (attributes, tableName) => {
  const result = {};

  for (const [key, value] of Object.entries(attributes)) {
    try {
      if (!value) {
        console.warn(
          `WARNING: ATTRIBUTE '${key}' IN TABLE '${tableName}' IS UNDEFINED OR NULL`
        );
        continue;
      }

      // * SKIP IF THIS IS A VIRTUAL FIELD
      if (value.type.toString() === 'VIRTUAL') continue;

      // * HANDLE DIFFERENT ATTRIBUTE TYPES
      let attributeDefinition = { ...value };

      if (!value.type) {
        console.warn(
          `Warning: Type for attribute '${key}' in table '${tableName}' is undefined`
        );
        attributeDefinition.type = 'STRING'; // * DEFAULT FALLBACK TYPE
      } else {
        const sequelizeType = getSequelizeType(value.type);
        // * CONVERT SPECIFIC SEQUELIZE TYPES TO THEIR SQL EQUIVALENTS
        switch (attributeDefinition.type) {
          case 'BOOLEAN':
            attributeDefinition.type = 'BOOLEAN';
            break;
          case 'STRING':
            attributeDefinition.type = `STRING${
              value.type._length ? `(${value.type._length})` : ''
            }`;
            break;
          case 'INTEGER':
            attributeDefinition.type = 'INTEGER';
            break;
          case 'BIGINT':
            attributeDefinition.type = 'BIGINT';
            break;
          case 'DECIMAL':
            attributeDefinition.type = `DECIMAL(${
              value.type._precision || 10
            },${value.type._scale || 0})`;
            break;
          case 'DOUBLE':
          case 'FLOAT':
            attributeDefinition.type = sequelizeType;
            break;
          case 'DATE':
          case 'DATETIME':
            attributeDefinition.type = 'TIMESTAMP WITH TIME ZONE';
            break;
          case 'ENUM':
            attributeDefinition.type = `"enum_${tableName}_${key}"`;
            break;
          case 'JSON':
            attributeDefinition.type = 'JSON';
            break;
          case 'JSONB':
            attributeDefinition.type = 'JSONB';
            break;
          default:
            attributeDefinition.type = sequelizeType;
          // * TODO - ADD SUPPORT FOR MORE TYPES
        }
      }

      // * REMOVE REFERENCE METADATA FROM ATTRIBUTE DEFINITION
      if (attributeDefinition.references) {
        delete attributeDefinition.references;
        delete attributeDefinition.onDelete;
        delete attributeDefinition.onUpdate;
      }

      // * HANDLE ALLOWNULL
      if (attributeDefinition.allowNull === undefined) {
        attributeDefinition.allowNull = true;
      }

      // * CLEAN UP UNNECESSARY PROPERTIES
      delete attributeDefinition.fieldName;
      delete attributeDefinition.field;

      if (attributeDefinition.type.includes('SEQUELIZE')) {
        console.warn(
          `WARNING: UNHANDLED SEQUELIZE TYPE FOR FIELD "${key}": ${value.type.toString()}`
        );
        continue;
      }

      result[key] = attributeDefinition;
    } catch (error) {
      console.error(
        `Error processing attribute '${key}' in table '${tableName}':`,
        error
      );
      // * SKIP THIS ATTRIBUTE
      continue;
    }
  }

  return result;
};

const generateMigration = async () => {
  const models = await loadModels();
  const enumCreationStatements = generateEnumTypes(models);
  const migrationStatements = [];
  let hasErrors = false;

  // * ENSURE MIGRATIONS DIRECTORY EXISTS
  const migrationsDir = path.dirname(outputFilePath);
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  // * FIRST, CREATE ALL TABLES
  for (const modelName in models) {
    try {
      const model = models[modelName];
      const attributes = generateTableAttributes(
        model.rawAttributes,
        model.tableName
      );

      if (Object.keys(attributes).length === 0) {
        console.error(`No valid attributes found for model '${modelName}'`);
        hasErrors = true;
        continue;
      }

      migrationStatements.push(`
        // * CREATE ${model.tableName} TABLE
        await queryInterface.createTable('${model.tableName}', {
          ${Object.entries(attributes)
            .map(([key, value]) => {
              delete value.references;
              delete value.Model;
              delete value._autoGenerated;
              delete value._modelAttribute;
              delete value.values;
              delete value.set;
              delete value.get;
              let typeDefinition = value.type;

              // * IF IT'S A CUSTOM ENUM TYPE, USE IT DIRECTLY
              if (typeDefinition.startsWith('"enum_')) {
                typeDefinition = typeDefinition.replace(/"/g, '');
                return `
                ${key}: {
                  type: '${typeDefinition}',
                  ${Object.entries(value)
                    .filter(([k]) => k !== 'type')
                    .map(
                      ([k, v]) =>
                        `${k}: ${typeof v === 'string' ? `'${v}'` : v}`
                    )
                    .join(',\n                ')}
                }`;
              } else if (typeDefinition === 'TIMESTAMP WITH TIME ZONE') {
                return `
                ${key}: {
                  type: Sequelize.DATE,
                  ${Object.entries(value)
                    .filter(([k]) => k !== 'type')
                    .map(
                      ([k, v]) =>
                        `${k}: ${typeof v === 'string' ? `'${v}'` : v}`
                    )
                    .join(',\n                ')}
                }`;
              } else {
                return `
                ${key}: {
                  type: Sequelize.${typeDefinition},
                  ${Object.entries(value)
                    .filter(([k]) => k !== 'type')
                    .map(
                      ([k, v]) =>
                        `${k}: ${typeof v === 'string' ? `'${v}'` : v}`
                    )
                    .join(',\n                ')}
                }`;
              }
            })
            .join(',\n        ')}
        });
      `);
    } catch (error) {
      console.error(`Model '${modelName}' has no rawAttributes`);
      hasErrors = true;
      continue;
    }
  }

  if (hasErrors) {
    console.warn('\nWarning: Some errors occurred during migration generation. Please review the console output and the generated migration file carefully.');
  }

  const output = `
    'use strict';
    module.exports = {
      up: async (queryInterface, Sequelize) => {
        ${enumCreationStatements.join('\n')}
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

          ${Array.from(
            new Set(
              Object.values(models).flatMap((model) =>
                Object.entries(model.rawAttributes)
                  .filter(([_, attr]) => attr.type instanceof DataTypes.ENUM)
                  .map(([fieldName]) => `enum_${model.tableName}_${fieldName}`)
              )
            )
          )
            .map(
              (enumTypeName) => `
          await queryInterface.sequelize.query('DROP TYPE IF EXISTS "${enumTypeName}";');
          `
            )
            .join('\n    ')}
      }
    };
`;

  // * OUTPUT THE MIGRATION TO FILE
  fs.writeFileSync(outputFilePath, output);
  console.log(`FRESH MIGRATION CREATED AT ${outputFilePath}`);
};

// * RUN THE GENERATE MIGRATION FUNCTION
generateMigration()
  .then(() => {
    console.log('MIGRATION GENERATION COMPLETE.');
    sequelize
      .close()
      .then(() => {
        console.log('SEQUELIZE CONNECTION CLOSED.');
        process.exit(0);
      })
      .catch((err) => {
        console.error('ERROR CLOSING SEQUELIZE CONNECTION:', err);
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error('ERROR GENERATING MIGRATION:', err);
    process.exit(1);
  });
