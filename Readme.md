# Migrations Squasher

## Overview

Migrations Squasher is an `npx` CLI tool designed to help developers manage and squash a large number of migrations generated over time in a project. This tool is particularly useful for projects that use Sequelize as their ORM.

## Problem Statement

As projects grow, the number of database migrations can become overwhelming. Each migration represents a change in the database schema, and over time, these migrations can accumulate, making it difficult to manage and maintain the database. Squashing migrations helps to consolidate these changes into a single migration, simplifying the database schema and improving performance.

## Features

- Squash multiple migrations into a single migration file.
- Maintain the integrity of the database schema.
- Easy to use with a simple CLI interface.
- Currently supports Sequelize ORM.

## Installation

You can run Migrations Squasher directly using `npx`:

```sh
npx migrations-squasher
```

## Usage

To squash migrations, navigate to your project directory and run:

```sh
npx migrations-squasher
```

Follow the on-screen prompts to select the migrations you want to squash.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the MIT License.
