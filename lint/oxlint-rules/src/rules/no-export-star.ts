import { defineRule } from '@oxlint/plugins'

/** Require public re-exports to name every exported symbol. */
export const noExportStarRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow export-all declarations.'
		},
		messages: {
			exportStar:
				'Export every name explicitly; export * hides the public surface. See AGENTS.md § Public and package boundaries.'
		}
	},
	create(context) {
		return {
			ExportAllDeclaration(node) {
				context.report({ node, messageId: 'exportStar' })
			}
		}
	}
})
