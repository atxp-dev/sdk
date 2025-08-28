import chalk from 'chalk';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEMO_REPO_URL = 'https://github.com/atxp-dev/agent-demo.git';
const DEMO_DIR = path.join(os.homedir(), '.cache', 'atxp', 'demo');
const DEMO_PORT = 8016; // AT=80, X=10, P=16 - clever ATXP pun!

export async function runDemo(): Promise<void> {
  try {
    console.log(chalk.blue('🚀 Starting ATXP demo...'));
    
    // Check if demo directory exists, if not clone it
    if (!await fs.pathExists(DEMO_DIR)) {
      console.log(chalk.blue('📥 Downloading demo from GitHub...'));
      await cloneDemoRepo();
    } else {
      console.log(chalk.blue('📂 Using existing demo...'));
      // Optionally pull latest changes
      await updateDemoRepo();
    }

    // Install dependencies if needed
    await installDependencies();

    // Start the demo and open browser
    await startDemo();

  } catch (error) {
    console.error(chalk.red('❌ Error starting demo:'), (error as Error).message);
    process.exit(1);
  }
}

async function cloneDemoRepo(): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['clone', DEMO_REPO_URL, DEMO_DIR], {
      stdio: 'inherit'
    });

    git.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Demo downloaded successfully'));
        resolve();
      } else {
        reject(new Error(`Git clone failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(new Error(`Failed to clone repository: ${error.message}`));
    });
  });
}

async function updateDemoRepo(): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['pull'], {
      cwd: DEMO_DIR,
      stdio: 'inherit'
    });

    git.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Demo updated successfully'));
        resolve();
      } else {
        console.log(chalk.yellow('⚠️  Could not update demo, using existing version'));
        resolve(); // Don't fail if update fails
      }
    });

    git.on('error', (error) => {
      console.log(chalk.yellow('⚠️  Could not update demo, using existing version'));
      resolve(); // Don't fail if update fails
    });
  });
}

async function installDependencies(): Promise<void> {
  console.log(chalk.blue('📦 Installing dependencies...'));
  
  return new Promise((resolve, reject) => {
    const npm = spawn('npm', ['run', 'install-all'], {
      cwd: DEMO_DIR,
      stdio: 'inherit'
    });

    npm.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Dependencies installed successfully'));
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    npm.on('error', (error) => {
      reject(new Error(`Failed to install dependencies: ${error.message}`));
    });
  });
}

async function startDemo(): Promise<void> {
  console.log(chalk.blue('🎮 Starting demo application...'));
  console.log(chalk.green(`✅ Demo will be available at: http://localhost:${DEMO_PORT}`));
  console.log(chalk.yellow('💡 Press Ctrl+C to stop the demo'));
  
  return new Promise((resolve, reject) => {
    // Set the port environment variable for the demo
    const env = { ...process.env, PORT: DEMO_PORT.toString() };
    
    const demo = spawn('npm', ['run', 'dev'], {
      cwd: DEMO_DIR,
      stdio: 'inherit',
      env
    });

    // Wait a bit for the server to start, then open browser
    setTimeout(async () => {
      try {
        console.log(chalk.blue('🌐 Opening browser...'));
        await open(`http://localhost:${DEMO_PORT}`);
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not open browser automatically'));
        console.log(chalk.white(`   Please open http://localhost:${DEMO_PORT} in your browser`));
      }
    }, 5000); // Wait 5 seconds for server to start

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down demo...'));
      demo.kill('SIGINT');
      cleanup();
      process.exit(0);
    });

    demo.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Demo stopped successfully'));
        cleanup();
        resolve();
      } else {
        console.log(chalk.red(`❌ Demo stopped with code ${code}`));
        cleanup();
        reject(new Error(`Demo process exited with code ${code}`));
      }
    });

    demo.on('error', (error) => {
      reject(new Error(`Failed to start demo: ${error.message}`));
    });
  });
}

async function cleanup(): Promise<void> {
  try {
    // Optionally clean up the demo directory
    // Uncomment the next line if you want to remove the demo after each run
    // await fs.remove(DEMO_DIR);
  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not clean up demo directory'));
  }
}
