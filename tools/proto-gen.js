#!/usr/bin/env node

/**
 * Proto generation script with protoc installation check
 * Cross-platform support: macOS, Linux, Windows
 *
 * Usage: node scripts/proto-gen.js <module>
 * Example: node scripts/proto-gen.js auth
 */

const { execSync, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const MODULE = process.argv[2] || 'auth';

// Detect operating system
function getOS() {
  const platform = os.platform();
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

// Check if protoc is installed
function isProtocInstalled() {
  try {
    const command = getOS() === 'windows' ? 'where protoc' : 'which protoc';
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Show installation instructions
function showInstallationGuide() {
  const currentOS = getOS();

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log("║  ERROR: 'protoc' (Protocol Buffers Compiler) is not installed      ║");
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Please install protoc using one of the following methods:');
  console.log('');

  if (currentOS === 'macos') {
    console.log('  ► macOS (Homebrew) [RECOMMENDED for your system]:');
    console.log('    brew install protobuf');
    console.log('');
    console.log('  Alternative - MacPorts:');
    console.log('    sudo port install protobuf3-cpp');
  } else if (currentOS === 'windows') {
    console.log('  ► Windows (Chocolatey) [RECOMMENDED for your system]:');
    console.log('    choco install protoc');
    console.log('');
    console.log('  Alternative - Scoop:');
    console.log('    scoop install protobuf');
    console.log('');
    console.log('  Alternative - winget:');
    console.log('    winget install Google.Protobuf');
  } else {
    console.log('  ► Ubuntu/Debian [RECOMMENDED for your system]:');
    console.log('    sudo apt update && sudo apt install -y protobuf-compiler');
    console.log('');
    console.log('  Alternative - Fedora/RHEL:');
    console.log('    sudo dnf install protobuf-compiler');
    console.log('');
    console.log('  Alternative - Arch Linux:');
    console.log('    sudo pacman -S protobuf');
  }

  console.log('');
  console.log('  Manual Installation (all platforms):');
  console.log('    1. Download from: https://github.com/protocolbuffers/protobuf/releases');
  console.log('    2. Extract the archive');
  console.log("    3. Add the 'bin' directory to your PATH");
  if (currentOS === 'windows') {
    console.log('       - Windows: Add to System Environment Variables > PATH');
  } else {
    console.log('       - Add to ~/.bashrc or ~/.zshrc: export PATH="$PATH:/path/to/protoc/bin"');
  }
  console.log('');
  console.log('After installation, verify with:');
  console.log('    protoc --version');
  console.log('');
  process.exit(1);
}

// Get the plugin path based on OS
function getPluginPath() {
  const isWindows = getOS() === 'windows';
  const pluginName = isWindows ? 'protoc-gen-ts_proto.cmd' : 'protoc-gen-ts_proto';
  return path.join('.', 'node_modules', '.bin', pluginName);
}

// Module configurations
const MODULES = {
  auth: {
    protoPath: './src/modules/sample/proto',
    outputPath: './src/modules/sample/proto',
    files: ['*.proto'],
  },
  // TODO: Add more modules as needed
};

// Run protoc for a module
function runProtoc(moduleName) {
  const config = MODULES[moduleName];
  if (!config) {
    console.error(`Unknown module: ${moduleName}`);
    console.error(`Available modules: ${Object.keys(MODULES).join(', ')}`);
    process.exit(1);
  }

  const pluginPath = getPluginPath();
  const protoFiles = config.files.map((f) => path.join(config.protoPath, f)).join(' ');

  const args = [
    `--plugin=${pluginPath}`,
    `--ts_proto_out=${config.outputPath}`,
    '--ts_proto_opt=nestJs=true',
    '--ts_proto_opt=addGrpcMetadata=true',
    '--ts_proto_opt=outputEncodeMethods=false',
    '--ts_proto_opt=outputJsonMethods=false',
    '--ts_proto_opt=outputClientImpl=false',
    `-I`,
    config.protoPath,
    ...config.files.map((f) => path.join(config.protoPath, f)),
  ];

  const result = spawnSync('protoc', args, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`Failed to generate proto for module: ${moduleName}`);
    process.exit(result.status || 1);
  }

  console.log(`✓ Proto generation completed for module: ${moduleName}`);
}

// Main
if (!isProtocInstalled()) {
  showInstallationGuide();
}

runProtoc(MODULE);
