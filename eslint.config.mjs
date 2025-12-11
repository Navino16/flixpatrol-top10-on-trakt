// @ts-check

import eslint from '@eslint/js';
import tsEslint from 'typescript-eslint';

export default tsEslint.config(
    {
        ignores: [
            "node_modules/",
            "build/",
            "tests/",
            "vitest.config.ts",
        ],
    },
    eslint.configs.recommended,
    tsEslint.configs.eslintRecommended,
    ...tsEslint.configs.recommended,
    {
        languageOptions: {
            parser: tsEslint.parser,
        },
        rules: {
            "max-len": ["error", { "code": 120, "ignoreStrings": true , "ignoreTemplateLiterals": true}],
            "import/prefer-default-export": "off"
        }
    }
);