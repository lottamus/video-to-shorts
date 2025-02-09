# video-to-shorts

A tool for automatically converting long-form videos into engaging short-form content using AI-powered scene analysis.

## Features

- 🎬 Automatically analyze video content using OpenAI's GPT-4 Vision
- ✂️ Intelligently trim, speed up, or keep scenes based on content
- 🎯 Customizable analysis criteria and confidence thresholds
- 📱 Output optimized for vertical video platforms
- 🚀 Process multiple videos in parallel using all CPU cores
- ⚡ Parallel frame analysis within each video
- 🎯 Process specific portions of videos with start/end times
- 🔧 Flexible configuration via JSON files or command line

## Examples

- [Lott Gaming](https://www.youtube.com/@lott_gaming/shorts) - my gaming YouTube channel

[![Lott Gaming](https://img.youtube.com/vi/emuyeHN9Dn4/maxresdefault.jpg)](https://www.youtube.com/shorts/emuyeHN9Dn4)

## Getting Started

### Prerequisites

- Node.js 18+
- FFmpeg (automatically installed on most platforms)
- OpenAI API key

### Installation

Using yarn:
```bash
yarn global add @shipworthy/video-to-shorts
```

Or using pnpm:
```bash
pnpm add -g @shipworthy/video-to-shorts
```

### Quick Start

Checkout the [CLI documentation](packages/cli/README.md) for more detailed usage instructions and options.

Process a directory of videos or a single video:

```bash
# Process a directory
video-to-shorts /path/to/videos

# Process a single video
video-to-shorts /path/to/video.mp4
```

### Advanced Usage

Checkout the [CLI documentation](packages/cli/README.md) for more detailed usage instructions and options.

```bash
# Process videos with debug logging
video-to-shorts ./videos --debug

# Process 2 videos concurrently (max: number of CPU cores)
video-to-shorts ./videos -j 2

# Analyze every 60th frame, 3 frames in parallel
video-to-shorts ./videos -f 60 -p 3

# Process specific portion of videos
video-to-shorts ./videos -s 00:30 -e 02:00

# Specify custom output directory
video-to-shorts ./videos -o ./shorts

# Process a video with start/end times in filename
video-to-shorts ./00:00:30-00:02:00.mp4
```

### Configuration

The analyzer configuration can be provided in two ways:

1. As a JSON file (`video-to-shorts.json`):
```json
{
  "keep": "Content is interesting, important, or high quality",
  "remove": "Content is unwanted, irrelevant, or of poor quality",
  "speedUp": "Content is repetitive, slow, or less interesting but still relevant",
  "confidenceThreshold": 0.7,
  "openaiApiKey": "your-api-key"  // Optional, can also be set via environment variable or CLI flag
}
```

2. As a JSON string directly in the command line:
```bash
video-to-shorts ./videos -c '{"keep": "Content is engaging", "confidenceThreshold": 0.8}'
```

For more detailed usage instructions and options, see the [CLI documentation](packages/cli/README.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For detailed contributing guidelines and instructions on updating the changelog, please see our [CONTRIBUTING.md](CONTRIBUTING.md).

### Development

This is a monorepo using Yarn workspaces. The main packages are:

- `@shipworthy/video-processor`: Core video processing and analysis logic
- `@shipworthy/video-to-shorts`: CLI interface

### Setup

1. Clone the repository

```bash
git clone https://github.com/lottamus/video-to-shorts.git
cd video-to-shorts
```

2. Install dependencies:
```bash
yarn install
```

### Building Packages

```bash
# Build all packages
yarn build
```

```bash
# Build a specific package
yarn build --filter @shipworthy/video-processor
```

### Running Tests

```bash
# Run all tests
yarn test
```

```bash
# Run tests for a specific package
yarn test --filter @shipworthy/video-processor
```

### Running CLI Locally

This command will build and run the CLI.

```bash
# Build & run the CLI for a single video with debug logging
yarn start -- ./videos/your-video.mp4 -d
```

```bash
# Build & run the CLI for a directory of videos with debug logging
yarn start -- ./videos -d
```

### Changelog

For changes that affect functionality or the user experience of the project, please update the changelog by running:

```bash
yarn changelog
```

## License

By using this project, you agree your creations and contributions will be licensed under the same terms, [MIT](LICENSE), as the project.

Thank you for your contributions! 🚀