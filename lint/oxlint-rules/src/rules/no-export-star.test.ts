import { RuleTester } from 'oxlint/plugins-dev'

import { noExportStarRule } from './no-export-star.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'exportStar' }

tester.run('oxlint-rules/no-export-star', noExportStarRule, {
	valid: [
		"export { a } from './a.js';",
		"export { a as b } from './a.js';",
		"export type { T } from './types.js';"
	],
	invalid: [
		{ code: "export * from './a.js';", errors: [error] },
		{ code: "export * as ns from './a.js';", errors: [error] }
	]
})
