const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        ...jestConfig.moduleNameMapper,
        // CSS-only module shared by the smartForms* components (@import 'c/smartFormsShared').
        '^c/smartFormsShared$': '<rootDir>/main/default/lwc/smartFormsShared/smartFormsShared.css'
    },
    modulePathIgnorePatterns: ['<rootDir>/.localdevserver'],
    testMatch: ['**/__tests__/**/*.test.js'],
    collectCoverageFrom: ['main/default/lwc/smartForms*/**/*.js', '!**/__tests__/**']
};
