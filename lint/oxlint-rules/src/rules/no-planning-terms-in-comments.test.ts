import { RuleTester } from 'oxlint/plugins-dev'

import { noPlanningTermsInCommentsRule } from './no-planning-terms-in-comments.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'planningTerm' }

tester.run('oxlint-rules/no-planning-terms-in-comments', noPlanningTermsInCommentsRule, {
	valid: [
		'// The setup order preserves dependency order.\nrun()',
		'const label = "R12 batch wave alpha 2 take two"',
		'// Each retry uses the same input.\nretry()',
		'// batch the writes per tick\nrun()',
		'// Wave cleanup runs after shutdown.\nrun()',
		'// Renders an h2 heading.\nrun()',
		'// Uploads go to the r2 bucket.\nrun()'
	],
	invalid: [
		{ code: '// R12 changed this path.\nrun()', errors: [error] },
		{ code: 'run() // batch 3 cleanup', errors: [error] },
		{ code: '/* batch R2 */\nrun()', errors: [error] },
		{ code: '// wave 2 moved this\nrun()', errors: [error] },
		{ code: '// wave two moved this\nrun()', errors: [error] },
		{ code: '// See iteration 4.\nrun()', errors: [error] },
		{ code: '// alpha 2\nrun()', errors: [error] },
		{ code: '// take two\nrun()', errors: [error] }
	]
})
