import type { CreateRule } from '@oxlint/plugins'

import createPaddingLineRule from '../vendor/eslint-stylistic/padding-line-between-statements.ts'

const paddingRule = createPaddingLineRule([
	{ blankLine: 'always', prev: 'import', next: '*' },
	{ blankLine: 'always', prev: '*', next: { selector: 'Program > :not(ImportDeclaration)' } },
	{ blankLine: 'always', prev: { selector: 'Program > :not(ImportDeclaration)' }, next: '*' },
	{ blankLine: 'always', prev: '*', next: ['function', 'class', 'interface', 'type'] },
	{ blankLine: 'always', prev: ['function', 'class', 'interface', 'type'], next: '*' },
	{ blankLine: 'any', prev: 'import', next: 'import' },
	{
		blankLine: 'any',
		prev: { selector: 'ExportNamedDeclaration[source]' },
		next: { selector: 'ExportNamedDeclaration[source]' }
	},
	{
		blankLine: 'any',
		prev: {
			selector:
				':matches(TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"])'
		},
		next: {
			selector:
				':matches(TSDeclareFunction, FunctionDeclaration, ExportNamedDeclaration[declaration.type="TSDeclareFunction"], ExportNamedDeclaration[declaration.type="FunctionDeclaration"])'
		}
	}
])

/**
 * Separate the import block, top-level statements, and declarations with whitespace-only fixes.
 * Statements inside a body stay as written: related guards group together and a multiline binding
 * is not a section break, so no rule entry separates them. A run of re-exports is a list like the
 * import block, not a run of declarations, so a barrel stays dense.
 */
export const requireReadableSpacingRule: CreateRule = {
	...paddingRule,
	meta: {
		...paddingRule.meta,
		docs: {
			description:
				'Require readable spacing around imports, top-level statements, and declarations.'
		},
		messages: {
			...paddingRule.meta.messages,
			expectedBlankLine:
				'Expected a blank line before this statement. See AGENTS.md § Readability and visual structure.'
		},
		schema: []
	}
}
