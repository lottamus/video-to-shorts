import { exec, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { logger } from "./logger";

const execAsync = promisify(exec);

async function spawnCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "pipe",
      shell: true,
    });

    proc.stdout?.on("data", (data) => {
      process.stdout.write(data);
    });

    proc.stderr?.on("data", (data) => {
      process.stderr.write(data);
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

async function checkHomebrew(): Promise<boolean> {
  try {
    await execAsync("brew --version");
    return true;
  } catch {
    return false;
  }
}

async function installHomebrew(): Promise<void> {
  logger.info("Installing Homebrew...");
  const installCommand =
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
  try {
    await spawnCommand("/bin/bash", ["-c", installCommand]);
    // After installation, we need to add Homebrew to PATH for the current session
    const brewPath = "/opt/homebrew/bin:/usr/local/bin";
    process.env.PATH = `${brewPath}:${process.env.PATH}`;
    logger.info("Homebrew installed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to install Homebrew: ${error.message}`);
    }
    throw error;
  }
}

async function checkFFmpeg(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

async function installFFmpeg(): Promise<void> {
  const platform = os.platform();
  let command: string;
  let args: string[] = [];

  switch (platform) {
    case "darwin": {
      const hasHomebrew = await checkHomebrew();
      if (!hasHomebrew) {
        logger.info("Homebrew is not installed.");
        try {
          await installHomebrew();
        } catch (error) {
          throw new Error(
            `Failed to install Homebrew. Please install FFmpeg manually. Error: ${error instanceof Error ? error.message : String(error)}`,
            {
              cause: error,
            }
          );
        }
      }
      command = "brew";
      args = ["install", "ffmpeg"];
      logger.info("Installing FFmpeg using Homebrew...");
      break;
    }
    case "linux":
      if (
        os.release().toLowerCase().includes("ubuntu") ||
        os.release().toLowerCase().includes("debian")
      ) {
        command = "sh";
        args = ["-c", "sudo apt-get update && sudo apt-get install -y ffmpeg"];
        logger.info("Installing FFmpeg using apt...");
      } else {
        throw new Error(
          "Automatic FFmpeg installation is only supported on Ubuntu/Debian Linux. Please install FFmpeg manually."
        );
      }
      break;
    case "win32": {
      logger.info("Installing FFmpeg for Windows...");
      // Create a temporary directory for FFmpeg
      const ffmpegDir = path.join(os.homedir(), ".ffmpeg");
      await fs.ensureDir(ffmpegDir);

      // PowerShell commands to:
      // 1. Download FFmpeg
      // 2. Extract it
      // 3. Add to PATH
      const downloadUrl =
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
      const powershellCommands = [
        // Download FFmpeg
        `$ProgressPreference = 'SilentlyContinue';`,
        `Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${path.join(ffmpegDir, "ffmpeg.zip")}';`,
        // Extract the zip
        `Expand-Archive -Path '${path.join(ffmpegDir, "ffmpeg.zip")}' -DestinationPath '${ffmpegDir}' -Force;`,
        // Find the bin directory
        `$binPath = (Get-ChildItem -Path '${ffmpegDir}' -Recurse -Filter 'bin' | Where-Object { $_.PSIsContainer } | Select-Object -First 1).FullName;`,
        // Add to PATH for current session
        `$env:Path = "$binPath;$env:Path";`,
        // Add to PATH permanently
        `[System.Environment]::SetEnvironmentVariable('Path', "$binPath;$([System.Environment]::GetEnvironmentVariable('Path', 'User'))", 'User');`,
      ];

      command = "powershell.exe";
      args = ["-Command", powershellCommands.join(" ")];
      break;
    }
    default:
      throw new Error(
        `Unsupported platform: ${platform}. Please install FFmpeg manually.`
      );
  }

  try {
    logger.debug("Running install command:");
    logger.debug(`${command} ${args.join(" ")}`);

    // Execute command with real-time output
    await spawnCommand(command, args);

    // Verify installation
    const { stdout: versionOutput } = await execAsync("ffmpeg -version");
    logger.debug("FFmpeg version:", versionOutput.split("\n")[0]);
    logger.info("FFmpeg installed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to install FFmpeg: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Ensures FFmpeg is available on the system, installing it if necessary.
 * @throws Error if FFmpeg installation fails
 */
export async function ensureFFmpeg(): Promise<void> {
  const hasFFmpeg = await checkFFmpeg();

  if (hasFFmpeg) {
    logger.debug("FFmpeg is already installed");
    return;
  }

  logger.info("FFmpeg is not installed.");
  await installFFmpeg();
}
