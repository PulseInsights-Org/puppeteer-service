module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/integration/',                  // Integration tests - run with npm run test:integration
    '/tests/e2e/'                           // E2E tests - run with npm run test:e2e
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: false,

  // Coverage thresholds — CI will fail if these are not met
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 93,
      lines: 93,
      statements: 93
    }
  },

  // Coverage reporters for both human and machine consumption
  coverageReporters: [
    'text',           // Console table output
    'text-summary',   // Compact console summary
    'lcov',           // HTML report in coverage/lcov-report/
    'json-summary'    // Machine-readable for scripts (coverage/coverage-summary.json)
  ]
};
