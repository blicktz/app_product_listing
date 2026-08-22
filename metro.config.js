const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const workerPath = path.resolve(__dirname, 'worker').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

config.resolver.blockList = [new RegExp(`^${workerPath}/.*`)];

module.exports = config;
