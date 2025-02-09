# @shipworthy/video-processor

A core video processing library for converting long-form videos into engaging short-form content. This package provides the underlying functionality used by the video-to-shorts CLI tool, including frame extraction, scene analysis, and video segmentation.

## Overview

The video processor handles the heavy lifting of processing and analyzing video files. It extracts frames at configurable intervals, performs parallel analysis, and segments the video based on content quality. Its modular design allows for easy customization of analysis criteria and processing parameters.

## Features

- Extracts frames at configurable intervals
- Supports parallel frame analysis for improved performance
- Integrates with OpenAI GPT-4 Vision for scene classification
- Segments videos to identify and isolate important content
- Modular and extensible architecture

## Installation

To install the package as a standalone dependency, run:

```bash
yarn add @shipworthy/video-processor
```

or using pnpm:

```bash
pnpm add @shipworthy/video-processor
```

If you're working within the video-to-shorts monorepo, this package is managed via Yarn workspaces.

## Usage

Below is a basic example of how to use the video processor in your project:

```javascript
import { processVideo } from '@shipworthy/video-processor';

// Process a video with specified options
processVideo('path/to/video.mp4', {
  frameInterval: 30,
  parallelFrames: 4,
  // Additional configuration options
})
  .then(result => {
    console.log('Video processed successfully!', result);
  })
  .catch(err => {
    console.error('Error processing video:', err);
  });
```

Refer to the source code and inline documentation for more details on available configuration options and API usage.

## Development

To get started with development:

1. Clone the repository and navigate to the project root.
2. Install dependencies:

```bash
yarn install
```

3. Build all packages (or just the video-processor package):

```bash
yarn build
```

4. Run tests:

```bash
yarn test
```

Make sure to run commands from the project root to respect the Yarn workspaces setup.

## Testing

To run tests specifically for the video-processor package, use:

```bash
yarn test --filter @shipworthy/video-processor
```

## Contributing

Contributions are welcome! Please refer to the main project's CONTRIBUTING.md for guidelines on how to contribute.

## License

This project is licensed under the terms specified in the LICENSE file. If no LICENSE file is present, please refer to the project's main repository for licensing details. 