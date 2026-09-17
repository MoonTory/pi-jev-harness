import {
	defineRule,
	type ESTree,
	type Scope,
	type SourceCode,
	type Variable
} from '@oxlint/plugins'

const commentOwnerKinds = new Set([
	'ExpressionStatement',
	'IfStatement',
	'PropertyDefinition',
	'ReturnStatement',
	'ThrowStatement',
	'VariableDeclaration'
])

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

function rootIdentifier(expression: ESTree.Expression): ESTree.IdentifierReference | null {
	if (expression.type === 'Identifier') return expression
	if (expression.type === 'MemberExpression') return rootIdentifier(expression.object)
	if (expression.type === 'ChainExpression') return rootIdentifier(expression.expression)
	if (
		expression.type === 'ParenthesizedExpression' ||
		expression.type === 'TSAsExpression' ||
		expression.type === 'TSNonNullExpression' ||
		expression.type === 'TSSatisfiesExpression' ||
		expression.type === 'TSTypeAssertion'
	) {
		return rootIdentifier(expression.expression)
	}
	return null
}

function typeName(annotation: ESTree.TSType): string | null {
	if (annotation.type !== 'TSTypeReference' || annotation.typeName.type !== 'Identifier')
		return null
	return annotation.typeName.name
}

function annotationAllowsIn(
	annotation: ESTree.TSType,
	localTypes: ReadonlyMap<string, boolean>
): boolean {
	if (annotation.type === 'TSUnionType' || annotation.type === 'TSUnknownKeyword') return true
	if (annotation.type === 'TSTypeReference') {
		const name = typeName(annotation)
		if (name === null || name === 'Record' || name === 'UnknownRecord' || name === 'AnyRecord')
			return false
		// Trusted: declared elsewhere.
		return localTypes.get(name) ?? true
	}
	return false
}

function contextualParameter(definitionName: ESTree.Node): boolean {
	let current = definitionName
	while (
		current.parent.type === 'AssignmentPattern' ||
		current.parent.type === 'ArrayPattern' ||
		current.parent.type === 'ObjectPattern' ||
		current.parent.type === 'Property' ||
		current.parent.type === 'RestElement'
	) {
		current = current.parent
		if (
			'typeAnnotation' in current &&
			current.typeAnnotation !== undefined &&
			current.typeAnnotation !== null
		) {
			return true
		}
	}

	const owner = current.parent
	if (
		owner.type !== 'ArrowFunctionExpression' &&
		owner.type !== 'FunctionExpression' &&
		owner.type !== 'FunctionDeclaration'
	) {
		return false
	}
	return owner.parent.type === 'CallExpression' && owner.parent.arguments.includes(owner)
}

function variableAllowsIn(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
	localTypes: ReadonlyMap<string, boolean>
): boolean {
	const variable = resolveVariable(sourceCode, identifier)
	if (variable === null) return false

	return variable.defs.some((definition) => {
		const name = definition.name
		if (
			'typeAnnotation' in name &&
			name.typeAnnotation !== undefined &&
			name.typeAnnotation !== null
		) {
			return annotationAllowsIn(name.typeAnnotation.typeAnnotation, localTypes)
		}
		if (definition.type === 'Parameter') return contextualParameter(name)
		if (definition.type !== 'Variable' || definition.node.type !== 'VariableDeclarator')
			return false
		return definition.node.init === null || definition.node.init.type !== 'ObjectExpression'
	})
}

function hasAdjacentComment(sourceCode: SourceCode, node: ESTree.BinaryExpression): boolean {
	let current: ESTree.Node = node
	while (true) {
		if (
			sourceCode
				.getCommentsBefore(current)
				.some(
					(comment) =>
						comment.end <= node.start &&
						/\b(?:inherit|narrow|prototype|union)/iu.test(comment.value)
				)
		) {
			return true
		}
		if (commentOwnerKinds.has(current.type) || current.parent.type === 'Program') return false
		current = current.parent
	}
}

/**
 * Require `Object.hasOwn` for runtime key presence; `in` narrows a union or a value already narrowed from `unknown`.
 * Trust named types declared in another file because this syntax-only rule cannot inspect imported unions.
 */
export const preferObjectHasOwnRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require Object.hasOwn for literal-key checks that do not narrow a union or unknown value.'
		},
		messages: {
			preferHasOwn:
				'Use `Object.hasOwn(value, key)` for record membership; reserve `in` for union narrowing or an adjacent comment naming the inherited-key exception (`inherit`, `narrow`, `prototype` or `union`).'
		}
	},
	createOnce(context) {
		const localTypes = new Map<string, boolean>()

		return {
			Program(node) {
				localTypes.clear()
				for (const statement of node.body) {
					const declaration =
						statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
					if (declaration?.type === 'TSInterfaceDeclaration')
						localTypes.set(declaration.id.name, false)
					if (declaration?.type === 'TSTypeAliasDeclaration') {
						localTypes.set(
							declaration.id.name,
							annotationAllowsIn(declaration.typeAnnotation, localTypes)
						)
					}
				}
			},
			BinaryExpression(node) {
				if (
					node.operator !== 'in' ||
					node.left.type !== 'Literal' ||
					typeof node.left.value !== 'string'
				)
					return
				if (hasAdjacentComment(context.sourceCode, node)) return
				const identifier = rootIdentifier(node.right)
				if (identifier !== null && variableAllowsIn(context.sourceCode, identifier, localTypes))
					return
				context.report({ node, messageId: 'preferHasOwn' })
			}
		}
	}
})
