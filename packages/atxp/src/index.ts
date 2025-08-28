#!/usr/bin/env node

import { createProject } from './create-project.js';
import { runDemo } from './run-demo.js';

// Detect if we're in create mode (npm create atxp)
const isCreateMode = process.argv[1].includes('create') || 
                    process.env.npm_config_argv?.includes('create') ||
                    process.argv.includes('--create');

if (isCreateMode) {
  console.log('🚀 Creating new ATXP project...');
  createProject();
} else {
  console.log('🎮 Starting ATXP demo...');
  runDemo();
}
