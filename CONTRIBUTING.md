# Contributing to video-to-shorts

Thank you for your interest in contributing to video-to-shorts! We welcome contributions from everyone and appreciate your support in improving this project.

## How to Contribute

There are several ways to contribute:
- Report bugs and suggest improvements by opening [issues](https://github.com/your-repo/issues).
- Submit pull requests with bug fixes, new features, or enhancements.
- Improve documentation.

## Getting Started

1. Fork the repository.
2. Clone your fork locally:

```bash
git clone https://github.com/{username}/video-to-shorts.git
cd video-to-shorts
```

3. Install dependencies:

```bash
yarn install
```

4. Build the project:

```bash
yarn build
```

5. Run tests to ensure everything is working as expected:

```bash
yarn test
```

Remember, always run commands from the repository root to respect the Yarn workspaces setup.

## Guidelines

- Follow the project's coding conventions and style guidelines.
- Write clear, concise commit messages.
- Ensure that your code is well tested before submitting a pull request. If you update tests, make sure they pass by running:

```bash
yarn test
```

- For changes in any sub-packages (e.g., `@shipworthy/video-processor` or `@shipworthy/video-to-shorts`), verify that tests pass for the entire repository.

## Pull Request Process

1. Create a branch for your changes.
2. Commit your changes with a clear commit message.
3. Push your branch to your fork.
4. Open a pull request against the main branch of the repository.
5. Describe your changes in detail and reference any relevant issues.
6. Address any feedback promptly.

## Changelog

For any change that affects the functionality or user experience of the project, please update the changelog. You can do this by running:

```bash
yarn changelog
```

This command will generate an appropriate changelog entry for your changes. Make sure to provide a clear description of your changes.

## Code of Conduct

By contributing, you agree to abide by the project's [Code of Conduct](CODE_OF_CONDUCT.md) (if one exists) to maintain a friendly, respectful, and collaborative environment.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project.

Thank you for your contributions! 🚀