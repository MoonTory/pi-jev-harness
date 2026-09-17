import {
	defineRule,
	type ESTree,
	type Scope,
	type SourceCode,
	type Variable
} from '@oxlint/plugins'

function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier)
	while (scope !== null) {
		const variable = scope.set.get(identifier.name)
		if (variable !== undefined) return variable
		scope = scope.upper
	}
	return null
}

function globalErrorIdentifier(
	sourceCode: SourceCode,
	node: ESTree.Expression
): node is ESTree.IdentifierReference {
	if (node.type !== 'Identifier' || node.name !== 'Error') return false
	if (sourceCode.isGlobalReference(node)) return true
	const variable = resolveVariable(sourceCode, node)
	return variable === null || variable.defs.length === 0
}

/** Reject `new Error(...)` in library source; every failure names its kind. */
export const noBareErrorConstructorRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow the bare Error constructor in library source.'
		},
		messages: {
			bareError:
				'Do not construct a bare Error. Use ConfigError for host-fixable configuration, TypeError for API misuse, or an existing domain error.'
		}
	},
	createOnce(context) {
		return {
			NewExpression(node) {
				if (!globalErrorIdentifier(context.sourceCode, node.callee)) return
				context.report({ node, messageId: 'bareError' })
			}
		}
	}
})
