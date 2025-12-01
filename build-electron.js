const fs = require('fs-extra');
const path = require('path');

async function copyElectronFiles() {
  try {
    console.log('Copying Electron files to build directory...');

    // Copy compiled main process files from dist/main to build/main
    if (await fs.pathExists('dist/main')) {
      await fs.copy('dist/main', 'build/main');
      console.log('Copied compiled main process files');
    } else {
      console.log(
        'No compiled main process files found. Run "npm run build:main" first.'
      );
    }

    // Copy assets directory
    if (await fs.pathExists('assets')) {
      await fs.copy('assets', 'build/assets');
      console.log('Copied assets directory');
    }

    // Create package.json in build directory with correct main entry point
    const packageJson = await fs.readJson('package.json');
    const { build, ...packageJsonWithoutBuild } = packageJson;
    const buildPackageJson = {
      ...packageJsonWithoutBuild,
      main: 'main/main/main.js',
    };
    await fs.writeJson('build/package.json', buildPackageJson, { spaces: 2 });
    console.log('Created package.json in build directory');

    console.log('Electron files copied successfully!');
  } catch (error) {
    console.error('Error copying Electron files:', error);
    process.exit(1);
  }
}

copyElectronFiles();
