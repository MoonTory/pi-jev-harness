import { RuleTester } from 'oxlint/plugins-dev'

import { noDateNowConstructorRule } from './no-date-now-constructor.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'redundantClock' }

tester.run('oxlint-rules/no-date-now-constructor', noDateNowConstructorRule, {
	valid: [
		'const value = new Date()',
		'const value = new Date(timestamp)',
		'const timestamp = Date.now()',
		'function make(Date: { new (value: number): unknown; now(): number }) { return new Date(Date.now()) }'
	],
	invalid: [{ code: 'const value = new Date(Date.now())', errors: [error] }]
})
