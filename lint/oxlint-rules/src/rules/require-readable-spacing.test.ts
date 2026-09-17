import { RuleTester } from 'oxlint/plugins-dev'

import createPaddingLineRule from '../vendor/eslint-stylistic/padding-line-between-statements.ts'
import { requireReadableSpacingRule } from './require-readable-spacing.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'expectedBlankLine' }

tester.run('oxlint-rules/require-readable-spacing', requireReadableSpacingRule, {
	valid: [
		"import { a } from 'a';\nimport { b } from 'b';\n\nexport const c = a + b;",
		'function f() {\nconst a = 1;\nconst b = 2;\n\nreturn a + b;\n}',
		'function f() { return 1; }',
		'function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: string | number) { return a; }',
		'export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: string | number) { return a; }',
		'const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\n\nreturn a + b;\n});',
		'export type A = string;\n\n/** B documentation. */\nexport type B = number;',
		'function f() { if (ok) { go(); } else { stop(); } }',
		'function f() {\n// return docs\nreturn 1;\n}',
		'const a = 1;\n\n\nconst b = 2;',
		'switch (x) { case 1: case 2: go(); break; default: stop(); }',
		// Related guards stay together, and a statement after a block keeps its position.
		'function f(a: unknown) {\nif (a === null) return null;\nif (a === undefined) return null;\nif (typeof a !== "string") return null;\nreturn a;\n}',
		'function f() {\nconst a = 1;\nreturn a;\n}',
		'function f() {\nif (ok) { go(); }\nstop();\n}',
		'function f() {\nfoo();\nwhile (ok) go();\n}',
		// A multiline binding is not a section break.
		'function f() {\nconst options = {\nretries: 2\n};\nconst b = 2;\nreturn b;\n}',
		// A barrel is a list of re-exports, not a run of declarations.
		"export { a } from './a.js';\nexport { b } from './b.js';\nexport type { C } from './c.js';",
		"import { z } from 'z';\n\nexport { a } from './a.js';\nexport { b } from './b.js';"
	],
	invalid: [
		{ code: 'const a = 1;\nconst b = 2;', output: 'const a = 1;\n\nconst b = 2;', errors: [error] },
		{
			code: 'export const a = 1;\n/** B docs. */\nexport type B = number;',
			output: 'export const a = 1;\n\n/** B docs. */\nexport type B = number;',
			errors: [error]
		},
		{
			code: 'const a = 1; // trailing\n// leading\nconst b = 2;',
			output: 'const a = 1; // trailing\n\n// leading\nconst b = 2;',
			errors: [error]
		},
		{ code: 'const a = 1; const b = 2;', output: 'const a = 1;\n\n const b = 2;', errors: [error] },
		{
			code: "import { a } from 'a';\nconst b = a;",
			output: "import { a } from 'a';\n\nconst b = a;",
			errors: [error]
		},
		{
			code: 'export interface A {}\nexport class B {}',
			output: 'export interface A {}\n\nexport class B {}',
			errors: [error]
		},
		{
			code: 'const a = 1\n;[1].forEach(f)',
			output: 'const a = 1\n\n;[1].forEach(f)',
			errors: [error]
		},
		{
			code: "export { a } from './a.js';\nexport const b = 1;",
			output: "export { a } from './a.js';\n\nexport const b = 1;",
			errors: [error]
		},
		{
			code: "import { z } from 'z';\nexport { a } from './a.js';",
			output: "import { z } from 'z';\n\nexport { a } from './a.js';",
			errors: [error]
		},
		{
			code: 'function outer() {\nconst a = 1;\nfunction inner() { return a; }\nreturn inner;\n}',
			output:
				'function outer() {\nconst a = 1;\n\nfunction inner() { return a; }\n\nreturn inner;\n}',
			errors: [error, error]
		}
	]
})

// Exercise upstream options that the repo policy does not enable.
tester.run(
	'vendored padding removal',
	createPaddingLineRule([{ blankLine: 'never', prev: '*', next: '*' }]),
	{
		valid: ['foo();\nbar();'],
		invalid: [
			{
				code: 'foo();\n\nbar();',
				output: 'foo();\nbar();',
				errors: [{ messageId: 'unexpectedBlankLine' }]
			},
			{
				code: 'foo();\n\n// comment\n\nbar();',
				output: null,
				errors: [{ messageId: 'unexpectedBlankLine' }]
			}
		]
	}
)
