import { RuleTester } from 'oxlint/plugins-dev'

import { preferObjectHasOwnRule } from './prefer-object-hasown.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'preferHasOwn' }

tester.run('oxlint-rules/prefer-object-hasown', preferObjectHasOwnRule, {
	valid: [
		"type Result = { ok: true } | { error: string }; function check(value: Result) { return 'error' in value }",
		"function check(value: { ok: true } | { error: string }) { return 'error' in value }",
		"function check(value: unknown) { return typeof value === 'object' && value !== null && 'error' in value }",
		"function check(value: object) { /* Inherited keys are part of this contract. */ return 'error' in value }",
		'function check(value: Record<string, unknown>, key: string) { return key in value }',
		"function check(value: Record<string, unknown>) { return Object.hasOwn(value, 'error') }",
		"import type { Row } from './types.ts'; function check(value: Row) { return 'id' in value }"
	],
	invalid: [
		{
			code: "function check(value: Record<string, unknown>) { return 'error' in value }",
			errors: [error]
		},
		{ code: "function check(value: object) { return 'error' in value }", errors: [error] },
		{
			code: "interface Row { id: number }; function check(value: Row) { return 'error' in value }",
			errors: [error]
		},
		{
			code: "export interface Row { id: number }; export function check(value: Row) { return 'id' in value }",
			errors: [error]
		},
		{ code: "function check(value) { return 'error' in value }", errors: [error] },
		{ code: "const value = { error: true }; 'error' in value", errors: [error] }
	]
})
