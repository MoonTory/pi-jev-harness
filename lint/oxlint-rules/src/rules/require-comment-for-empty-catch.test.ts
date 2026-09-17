import { RuleTester } from 'oxlint/plugins-dev'

import { requireCommentForEmptyCatchRule } from './require-comment-for-empty-catch.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'missingComment' }

tester.run('oxlint-rules/require-comment-for-empty-catch', requireCommentForEmptyCatchRule, {
	valid: [
		'try { run() } catch { // The fallback is complete without the optional value.\n }',
		'try { run() } catch { /* The caller requested best-effort cleanup. */ }',
		'try { run() } catch (error) { report(error) }'
	],
	invalid: [
		{ code: 'try { run() } catch {}', errors: [error] },
		{ code: 'try { run() } catch (error) {}', errors: [error] },
		{ code: '// Retry is optional.\ntry { run() } catch {}', errors: [error] }
	]
})
