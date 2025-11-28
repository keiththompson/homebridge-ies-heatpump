# Contributing to homebridge-ies-heatpump

Thank you for your interest in contributing to homebridge-ies-heatpump! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js ^20.18.0, ^22.10.0, or ^24.0.0
- npm
- Git

### Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/homebridge-ies-heatpump.git
   cd homebridge-ies-heatpump
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Run tests to verify your setup:
   ```bash
   npm test
   ```

## Code Style

This project uses TypeScript with strict mode enabled and enforces consistent code style through automated tooling.

### TypeScript

- Strict mode is enabled
- Use type imports: `import type { Foo } from './foo'`
- Explicit return types are encouraged for functions
- Avoid `any` where possible

### Formatting & Linting

- **Prettier** handles code formatting
- **ESLint** enforces code quality rules

Configuration:
- Single quotes
- Semicolons required
- 2-space indentation
- 120 character line width
- Trailing commas

### Pre-commit Hooks

This project uses Husky with lint-staged to automatically run linting and formatting on staged files before each commit. This ensures all committed code meets the project's style requirements.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build the TypeScript project |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without changes |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run validate` | Run typecheck, lint, and test |

## Testing

- Write tests for new features and bug fixes
- Tests use [Vitest](https://vitest.dev/)
- Test files should be named `*.test.ts`
- Run the full test suite before submitting a PR:
  ```bash
  npm run validate
  ```

## Pull Request Process

1. Create a feature branch from `latest`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes, following the code style guidelines
3. Write or update tests as needed
4. Ensure all checks pass:
   ```bash
   npm run validate
   ```
5. Commit your changes with a clear, descriptive message
6. Push to your fork and open a Pull Request against the `latest` branch
7. Fill out the PR template with a description of your changes

### PR Requirements

- All CI checks must pass (lint, typecheck, tests, build)
- Tests are run on Node.js 20.x and 22.x
- Code coverage should not decrease significantly
- PR description should clearly explain the changes and motivation

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/keiththompson/homebridge-ies-heatpump/issues)
- Check existing issues before creating a new one
- Use the provided issue templates for bugs, features, and support requests

## Questions?

If you have questions about contributing, feel free to open a [support request](https://github.com/keiththompson/homebridge-ies-heatpump/issues/new?template=support-request.md).
