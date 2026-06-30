const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'android/**',
      'ios/**',
      'node_modules/**',
      '.expo/**',
      'supabase/functions/**',
      '*.aab',
    ],
  },
];
