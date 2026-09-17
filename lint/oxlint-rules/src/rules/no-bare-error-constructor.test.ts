import { RuleTester } from 'oxlint/plugins-dev'

import { noBareErrorConstructorRule } from './no-bare-error-constructor.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'bareError' }

tester.run('oxlint-rules/no-bare-error-constructor', noBareErrorConstructorRule, {
	valid: [
		"const value = new TypeError('Invalid value')",
		"const value = new ConfigError({ message: 'Invalid config', issues: [] })",
		"class Error { constructor(readonly message: string) {} } const value = new Error('local')",
		"function make(Error: new (message: string) => unknown) { return new Error('local') }"
	],
	invalid: [
		{ code: "const value = new Error('failure')", errors: [error] },
		{ code: 'throw new Error()', errors: [error] }
	]
})
