const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests', testMatch: /.*\.extension\.test\.js/, timeout: 30000, workers: 1, reporter: 'list' });
