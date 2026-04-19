//metro.config.js is the reactnative and expo bundler
// a bundler is a tool that bundles the code into a single file for the app to run
// so it starts from the entry point like index.js and then follows all imports and requires
// necessarry for hot reloading and debugging


const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
