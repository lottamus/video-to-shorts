import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Get the directory where the CLI is installed
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export const defaultConfig = {
  config: path.join(process.cwd(), "video-to-shorts.json"),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  tempDir: path.join(packageRoot, ".temp"),
  frameInterval: 60,
  parallelFrames: 3,
};
