import { eslintCompatPlugin } from '@oxlint/plugins'

import { noBareErrorConstructorRule } from './rules/no-bare-error-constructor.ts'
import { noChainedTypeAssertionsRule } from './rules/no-chained-type-assertions.ts'
import { noDateNowConstructorRule } from './rules/no-date-now-constructor.ts'
import { noExportStarRule } from './rules/no-export-star.ts'
import { noPlanningTermsInCommentsRule } from './rules/no-planning-terms-in-comments.ts'
import { noReduceAccumulatorCopyRule } from './rules/no-reduce-accumulator-copy.ts'
import { noReflectApplyRule } from './rules/no-reflect-apply.ts'
import { noForbiddenTermInSymbolNamesRule } from './rules/no-shape-in-symbol-names.ts'
import { noUnknownTypeAliasesRule } from './rules/no-unknown-type-aliases.ts'
import { noWidenThenAssertRule } from './rules/no-widen-then-assert.ts'
import { preferObjectHasOwnRule } from './rules/prefer-object-hasown.ts'
import { requireCommentForEmptyCatchRule } from './rules/require-comment-for-empty-catch.ts'
import { requireReadableSpacingRule } from './rules/require-readable-spacing.ts'
import { requireSafetyCommentForTypeAssertionRule } from './rules/require-safety-comment-for-type-assertion.ts'

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const oxlintRulesPlugin = eslintCompatPlugin({
	meta: { name: 'oxlint-rules' },
	rules: {
		'no-bare-error-constructor': noBareErrorConstructorRule,
		'no-chained-type-assertions': noChainedTypeAssertionsRule,
		'no-date-now-constructor': noDateNowConstructorRule,
		'no-export-star': noExportStarRule,
		'no-planning-terms-in-comments': noPlanningTermsInCommentsRule,
		'no-reduce-accumulator-copy': noReduceAccumulatorCopyRule,
		'no-reflect-apply': noReflectApplyRule,
		'no-shape-in-symbol-names': noForbiddenTermInSymbolNamesRule,
		'no-unknown-type-aliases': noUnknownTypeAliasesRule,
		'no-widen-then-assert': noWidenThenAssertRule,
		'prefer-object-hasown': preferObjectHasOwnRule,
		'require-comment-for-empty-catch': requireCommentForEmptyCatchRule,
		'require-readable-spacing': requireReadableSpacingRule,
		'require-safety-comment-for-type-assertion': requireSafetyCommentForTypeAssertionRule
	}
})

export default oxlintRulesPlugin
