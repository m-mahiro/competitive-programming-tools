import java.util.*;
import java.util.regex.*;

import javax.lang.model.element.*;
import javax.lang.model.type.*;

import com.sun.source.tree.*;
import com.sun.source.util.*;

/**
 * ソースを同じパッケージへ移す前に、javac が解決した宣言ごとに提出時の名前を決める。
 */
final class JavaBundleNames {
	// 識別子は、Unicode エスケープを含めて1つのトークンにする。名前を比べるときは、javac と同じくエスケープを読んでから比べる。
	private static final String ESCAPE = "\\\\u+\\p{XDigit}{4}";
	private static final Pattern UNICODE_ESCAPE = Pattern.compile("\\\\u+(\\p{XDigit}{4})");
	// javac は宣言名だけの位置を公開しない。宣言の範囲内でコメントと空白を飛ばしてトークンを探す。
	private static final Pattern TOKEN = Pattern.compile("//[^\r\n]*|/\\*.*?\\*/|\"\"\".*?\"\"\"|\"(?:[^\"\\\\]++|\\\\.)*+\"|'(?:[^'\\\\]++|\\\\.)*+'"
			+ "|\\s+|(?:" + ESCAPE + "|\\p{javaJavaIdentifierStart})(?:" + ESCAPE + "|\\p{javaJavaIdentifierPart})*|.", Pattern.DOTALL);
	private final List<Unit> units;
	private final Set<String> reserved = new HashSet<>();
	/** パッケージを外すか入れ子の型を修飾したとき、その参照位置で名前を隠されるトップレベルの型。 */
	private final Set<String> shadowedTypes = new HashSet<>();
	private final Set<String> topLevelNames = new HashSet<>();
	private final Map<String, String> typeNames = new HashMap<>();
	private final Map<String, String> binaryNames = new HashMap<>();
	private final Map<String, String> fieldNames = new HashMap<>();
	private final Map<String, Set<String>> candidates = new HashMap<>();
	private final Set<String> qualify = new HashSet<>();
	private final TypeElement entry;
	private boolean shortenedTypeReference;
	private final Map<String, Integer> nextSuffix = new HashMap<>();

	JavaBundleNames(final List<Unit> units, final TypeElement entry) {
		this.units = units;
		this.entry = entry;
		final Set<String> bundledTopLevels = new HashSet<>();
		for (final Unit unit : units) {
			for (final Tree tree : unit.analysis.solution().getTypeDecls())
				if (tree instanceof ClassTree && unit.analysis.trees().getElement(TreePath.getPath(unit.analysis.solution(), tree)) instanceof TypeElement type)
					bundledTopLevels.add(unit.binary(type));
		}
		for (final Unit unit : units) collectNames(unit, bundledTopLevels);
		topLevelNames.add("Main");
		for (final Unit unit : units) allocateNames(unit);
		// 別ファイルのワイルドカードから見える型は、そこで未使用でも展開後に単純名を曖昧にする。
		if (units.size() > 1) {
			final Set<String> scopes = new HashSet<>(Set.of("java.lang"));
			for (final Unit unit : units) {
				for (final ImportTree imported : unit.analysis.solution().getImports()) {
					if (imported.getQualifiedIdentifier() instanceof MemberSelectTree select && select.getIdentifier().contentEquals("*"))
						scopes.add(select.getExpression().toString());
				}
			}
			final var symbols = units.getFirst().analysis.elements();
			for (final var group : candidates.entrySet()) {
				for (final String scope : scopes) {
					final TypeElement visible = symbols.getTypeElement(scope + "." + group.getKey());
					if (visible != null) group.getValue().add(symbols.getBinaryName(visible).toString());
				}
			}
		}
		for (final var group : candidates.entrySet()) {
			if (group.getValue().size() > 1 || topLevelNames.contains(group.getKey())) qualify.add(group.getKey());
		}
	}

	private static java.util.stream.Stream<MatchResult> tokens(final String code, final int start, final int end) {
		return TOKEN.matcher(code).region(start, end).results().filter(token -> !token.group().isBlank()
				&& !token.group().startsWith("//") && !token.group().startsWith("/*"));
	}

	/** トークンの文字列。Unicode エスケープは、javac と同じく文字として読む。 */
	private static String text(final MatchResult token) {
		return UNICODE_ESCAPE.matcher(token.group())
				.replaceAll(escape -> Matcher.quoteReplacement(String.valueOf((char) Integer.parseInt(escape.group(1), 16))));
	}

	private static JavaSourceTransformer.Edit edit(final MatchResult token, final String text) {
		return new JavaSourceTransformer.Edit(token.start(), token.end(), text);
	}

	private static JavaSourceTransformer.Edit declaration(final Unit unit, final int start, final int end, final String name,
														  final String replacement, final boolean constructor) {
		final Iterator<MatchResult> tokens = tokens(unit.code, start, end).iterator();
		while (tokens.hasNext()) {
			final MatchResult token = tokens.next();
			if (!text(token).equals(name)) continue;
			if (constructor && (!tokens.hasNext() || !Set.of("(", "{").contains(text(tokens.next())))) continue;
			return edit(token, replacement);
		}
		throw new IllegalStateException("Could not identify the declaration of " + name + " at offset " + start);
	}

	private static boolean isCanonical(final TypeElement type, final ExecutableElement constructor) {
		final var components = type.getRecordComponents();
		final var parameters = constructor.getParameters();
		if (components.size() != parameters.size()) return false;
		for (int i = 0; i < components.size(); i++)
			if (!components.get(i).getSimpleName().equals(parameters.get(i).getSimpleName())
					|| !components.get(i).asType().toString().equals(parameters.get(i).asType().toString()))
				return false;
		return true;
	}

	boolean requiresVerification() {
		return shortenedTypeReference || units.size() > 1 || !entry.getSimpleName().contentEquals("Main") || !nextSuffix.isEmpty() || units.getFirst().analysis.hasErrors();
	}

	private void collectNames(final Unit unit, final Set<String> bundledTopLevels) {
		new TreePathScanner<Void, Void>() {
			@Override
			public Void scan(final Tree node, final Void unused) {
				if (node instanceof ClassTree tree) reserved.add(tree.getSimpleName().toString());
				if (node instanceof VariableTree tree) reserved.add(tree.getName().toString());
				if (node instanceof TypeParameterTree tree) reserved.add(tree.getName().toString());
				if (node instanceof IdentifierTree tree) reserved.add(tree.getName().toString());
				return super.scan(node, unused);
			}

			@Override
			public Void visitImport(final ImportTree tree, final Void unused) {
				final TreePath target = new TreePath(getCurrentPath(), tree.getQualifiedIdentifier());
				if (unit.analysis.trees().getElement(target) instanceof TypeElement type) {
					final String name = type.getSimpleName().toString();
					reserved.add(name);
					candidates.computeIfAbsent(name, key -> new HashSet<>()).add(unit.binary(type));
					if (!tree.isStatic() && type.getNestingKind() == NestingKind.MEMBER) unit.importedMembers.add(type);
				} else if (!tree.isStatic() && target.getLeaf() instanceof MemberSelectTree select && select.getIdentifier().contentEquals("*")
						&& unit.analysis.trees().getElement(new TreePath(target, select.getExpression())) instanceof TypeElement owner) {
					for (final Element member : unit.analysis.elements().getAllMembers(owner))
						if (member instanceof TypeElement nested) unit.importedMembers.add(nested);
				}
				return null;
			}

			private void remember() {
				final TreePath path = getCurrentPath();
				if (!(unit.analysis.trees().getElement(path) instanceof TypeElement type)) return;
				candidates.computeIfAbsent(type.getSimpleName().toString(), key -> new HashSet<>()).add(unit.binary(type));
				if (!unit.hasSourceRange(path.getLeaf())) return;
				if ((path.getLeaf() instanceof MemberSelectTree && type.getNestingKind() == NestingKind.TOP_LEVEL)
						|| (path.getLeaf() instanceof IdentifierTree && unit.needsImportOwner(type, path))) {
					while (type.getEnclosingElement() instanceof TypeElement owner) type = owner;
					final String binary = unit.binary(type);
					if (bundledTopLevels.contains(binary) && !shadowedTypes.contains(binary) && hiddenAt(unit, type, path))
						shadowedTypes.add(binary);
				}
			}

			@Override
			public Void visitIdentifier(final IdentifierTree node, final Void unused) {
				remember();
				return super.visitIdentifier(node, unused);
			}

			@Override
			public Void visitMemberSelect(final MemberSelectTree node, final Void unused) {
				remember();
				return super.visitMemberSelect(node, unused);
			}
		}.scan(unit.analysis.solution(), null);
	}

	/** パッケージを外して書く型名が、この位置でローカルの宣言や継承したメンバーに隠れるか。 */
	private static boolean hiddenAt(final Unit unit, final TypeElement type, final TreePath path) {
		TreePath use = path;
		while (use.getParentPath().getLeaf() instanceof MemberSelectTree select && select.getExpression() == use.getLeaf()
				&& unit.analysis.trees().getElement(use.getParentPath()) instanceof TypeElement) use = use.getParentPath();
		final Tree parent = use.getParentPath().getLeaf();
		final boolean expression = parent instanceof MemberSelectTree select && select.getExpression() == use.getLeaf()
				&& !select.getIdentifier().contentEquals("class") || parent instanceof MemberReferenceTree ref && ref.getMode() == MemberReferenceTree.ReferenceMode.INVOKE;
		final var name = type.getSimpleName();
		final java.util.function.Predicate<Element> hides = member -> member.getSimpleName().contentEquals(name)
				&& (member instanceof TypeElement other && !unit.binary(other).equals(unit.binary(type))
				|| member instanceof TypeParameterElement || expression && member instanceof VariableElement);
		for (Scope scope = unit.analysis.trees().getScope(path); scope != null && scope.getEnclosingClass() != null; scope = scope.getEnclosingScope()) {
			for (final Element local : scope.getLocalElements()) if (hides.test(local)) return true;
			for (final Element member : unit.analysis.elements().getAllMembers(scope.getEnclosingClass())) if (hides.test(member)) return true;
		}
		return false;
	}

	private String nextName(final String base) {
		int suffix = nextSuffix.getOrDefault(base, 1);
		String result;
		do {
			result = base + suffix++;
		} while (!reserved.add(result));
		nextSuffix.put(base, suffix);
		return result;
	}

	private void allocateNames(final Unit unit) {
		new TreePathScanner<Void, Void>() {
			@Override
			public Void visitClass(final ClassTree tree, final Void unused) {
				final TypeElement type = (TypeElement) unit.analysis.trees().getElement(getCurrentPath());
				final String old = type.getSimpleName().toString();
				final String binary = unit.binary(type);
				final boolean topLevel = type.getNestingKind() == NestingKind.TOP_LEVEL;
				String name = old;
				if (type == entry) name = "Main";
				// パッケージを外した型が、別のトップレベル型やスコープ内の宣言に隠れない名前を選ぶ。
				else if (old.equals("Main") || topLevel && (topLevelNames.contains(old) || shadowedTypes.contains(binary))) name = nextName(old);
				typeNames.put(binary, name);
				if (topLevel) {
					topLevelNames.add(name);
					binaryNames.put(binary, name);
				} else {
					Element owner = type.getEnclosingElement();
					while (!(owner instanceof TypeElement)) owner = owner.getEnclosingElement();
					final String parent = unit.binary((TypeElement) owner);
					final String suffix = binary.substring(parent.length(), binary.length() - old.length());
					binaryNames.put(binary, binaryNames.get(parent) + suffix + name);
				}
				return super.visitClass(tree, unused);
			}

			@Override
			public Void visitTypeParameter(final TypeParameterTree tree, final Void unused) {
				if (tree.getName().contentEquals("Main"))
					unit.localNames.put(unit.analysis.trees().getElement(getCurrentPath()), nextName("Main"));
				return super.visitTypeParameter(tree, unused);
			}

			@Override
			public Void visitVariable(final VariableTree tree, final Void unused) {
				if (tree.getName().contentEquals("Main") && !entry.getSimpleName().contentEquals("Main")) {
					final VariableElement variable = (VariableElement) unit.analysis.trees().getElement(getCurrentPath());
					if (variable != null && unit.end(tree) >= 0 && variable.getKind() != ElementKind.ENUM_CONSTANT
							&& !(variable.getEnclosingElement() instanceof TypeElement owner && owner.getKind() == ElementKind.RECORD)) {
						final String name = nextName("Main");
						unit.localNames.put(variable, name);
						if (variable.getKind() == ElementKind.FIELD)
							fieldNames.put(unit.binary((TypeElement) variable.getEnclosingElement()) + ".Main", name);
					}
				}
				return super.visitVariable(tree, unused);
			}
		}.scan(unit.analysis.solution(), null);
	}

	private String variableName(final Unit unit, final VariableElement variable) {
		final String name = variable.getSimpleName().toString();
		return variable.getKind() == ElementKind.FIELD && variable.getEnclosingElement() instanceof TypeElement owner
				? fieldNames.getOrDefault(unit.binary(owner) + "." + name, name) : unit.localNames.getOrDefault(variable, name);
	}

	/** 入れ子も含め、展開後にトップレベルの型からたどる名前。 */
	private String bundledName(final Unit unit, final TypeElement type) {
		final String name = typeNames.get(unit.binary(type));
		return type.getEnclosingElement() instanceof TypeElement owner ? bundledName(unit, owner) + "." + name : name;
	}

	boolean needsQualification(final ImportTree imported) {
		final Tree target = imported.getQualifiedIdentifier();
		return !imported.isStatic() && target instanceof MemberSelectTree member && qualify.contains(member.getIdentifier().toString());
	}

	void verify(final JavaSourceTransformer.Analysis output) {
		final List<String> expected = new ArrayList<>();
		for (final Unit unit : units) expected.addAll(bindings(unit, true));
		final List<String> actual = bindings(new Unit("", output), false);
		for (int i = 0; i < Math.max(expected.size(), actual.size()); i++) {
			final String before = i < expected.size() ? expected.get(i) : "(end)";
			final String after = i < actual.size() ? actual.get(i) : "(end)";
			if (!before.equals(after))
				throw new IllegalStateException("Name resolution changed after bundling: " + before + " -> " + after);
		}
	}

	/**
	 * パッケージ・import の文字列や別の JavacTask の Element を直接比較せず、移動後の所有型と署名で比較する。
	 */
	private List<String> bindings(final Unit unit, final boolean original) {
		final List<String> result = new ArrayList<>();
		new TreePathScanner<Void, Void>() {
			private String owner(final TypeElement type) {
				final String name = unit.binary(type);
				return original ? binaryNames.getOrDefault(name, name) : name;
			}

			private String erased(final TypeMirror type) {
				final TypeMirror erased = unit.analysis.types().erasure(type);
				if (erased instanceof ArrayType array) return erased(array.getComponentType()) + "[]";
				if (erased instanceof DeclaredType declared) return owner((TypeElement) declared.asElement());
				return erased.toString();
			}

			private String method(final ExecutableElement element) {
				return owner((TypeElement) element.getEnclosingElement()) + "." + element.getSimpleName()
						+ element.getParameters().stream().map(p -> erased(p.asType())).toList();
			}

			private void reference() {
				final Element element = unit.analysis.trees().getElement(getCurrentPath());
				if (element instanceof TypeElement type) result.add("type " + owner(type));
				else if (element instanceof TypeParameterElement parameter)
					result.add("parameter " + unit.localNames.getOrDefault(parameter, parameter.getSimpleName().toString()));
				else if (element instanceof ExecutableElement executable) result.add("method " + method(executable));
				else if (element instanceof VariableElement var && var.getEnclosingElement() instanceof TypeElement type)
					result.add("field " + owner(type) + "." + (original ? variableName(unit, var) : var.getSimpleName()));
				else if (element instanceof VariableElement var)
					result.add("variable " + (original ? variableName(unit, var) : var.getSimpleName()));
			}

			@Override
			public Void visitIdentifier(final IdentifierTree tree, final Void unused) {
				reference();
				return super.visitIdentifier(tree, unused);
			}

			@Override
			public Void visitMemberSelect(final MemberSelectTree tree, final Void unused) {
				reference();
				// Map.Entry と import された Entry は、外側の型が省略されても同じ型を指す。
				if (unit.analysis.trees().getElement(getCurrentPath()) instanceof TypeElement
						&& (tree.getExpression() instanceof IdentifierTree || tree.getExpression() instanceof MemberSelectTree))
					return null;
				return super.visitMemberSelect(tree, unused);
			}

			@Override
			public Void visitMemberReference(final MemberReferenceTree tree, final Void unused) {
				reference();
				return super.visitMemberReference(tree, unused);
			}

			@Override
			public Void visitNewClass(final NewClassTree tree, final Void unused) {
				reference();
				return super.visitNewClass(tree, unused);
			}

			@Override
			public Void visitMethod(final MethodTree tree, final Void unused) {
				final Element element = unit.analysis.trees().getElement(getCurrentPath());
				if (units.size() > 1 && element instanceof ExecutableElement executable && element.getKind() == ElementKind.METHOD) {
					final TypeElement child = (TypeElement) executable.getEnclosingElement();
					final Set<String> overridden = new TreeSet<>();
					TypeMirror parent = child.getSuperclass();
					while (parent instanceof DeclaredType base) {
						final TypeElement parentType = (TypeElement) base.asElement();
						for (final Element member : parentType.getEnclosedElements()) {
							if (!(member instanceof ExecutableElement candidate) || !member.getSimpleName().equals(element.getSimpleName()))
								continue;
							if (!Collections.disjoint(candidate.getModifiers(), Set.of(Modifier.PUBLIC, Modifier.PROTECTED, Modifier.PRIVATE)))
								continue;
							if (unit.analysis.elements().overrides(executable, candidate, child))
								overridden.add(method(candidate));
						}
						parent = parentType.getSuperclass();
					}
					result.add("overrides " + method(executable) + " " + overridden);
				}
				return super.visitMethod(tree, unused);
			}

			void run() {
				for (final Tree declaration : unit.analysis.solution().getTypeDecls())
					scan(TreePath.getPath(unit.analysis.solution(), declaration), null);
			}
		}.run();
		return result;
	}

	List<JavaSourceTransformer.Edit> edits(final Unit unit) {
		final List<JavaSourceTransformer.Edit> edits = new ArrayList<>();
		new TreePathScanner<Void, Void>() {
			private Element element() {return unit.analysis.trees().getElement(getCurrentPath());}

			private String nameOf(final Element symbol) {
				if (symbol instanceof VariableElement variable) return variableName(unit, variable);
				return symbol instanceof TypeElement type ? typeNames.get(unit.binary(type)) : unit.localNames.get(symbol);
			}

			@Override
			public Void visitImport(final ImportTree node, final Void unused) {return null;}

			@Override
			public Void visitClass(final ClassTree tree, final Void unused) {
				final TypeElement type = (TypeElement) element();
				final String old = type.getSimpleName().toString();
				final String name = nameOf(type);
				final int start = unit.start(tree);
				final int afterModifiers = Math.max(start, unit.end(tree.getModifiers()));
				if (type == entry && !type.getModifiers().contains(Modifier.PUBLIC))
					edits.add(new JavaSourceTransformer.Edit(start, start, "public "));
				if (type != entry && type.getNestingKind() == NestingKind.TOP_LEVEL && type.getModifiers().contains(Modifier.PUBLIC)) {
					for (final MatchResult token : tokens(unit.code, start, afterModifiers).toList()) {
						if (!text(token).equals("public")) continue;
						int end = token.end();
						while (end < afterModifiers + 1 && end < unit.code.length() && unit.code.charAt(end) == ' ')
							end++;
						edits.add(new JavaSourceTransformer.Edit(token.start(), end, ""));
					}
				}
				if (!old.equals(name)) edits.add(declaration(unit, afterModifiers, unit.end(tree), old, name, false));
				return super.visitClass(tree, unused);
			}

			@Override
			public Void visitMethod(final MethodTree tree, final Void unused) {
				if (tree.getReturnType() == null && unit.end(tree) >= 0 && element() instanceof ExecutableElement method) {
					final TypeElement type = (TypeElement) method.getEnclosingElement();
					// package-private な record を public Main にすると、正規コンストラクターにも public が必要になる。
					if (type == entry && type.getKind() == ElementKind.RECORD && !type.getModifiers().contains(Modifier.PUBLIC)
							&& !method.getModifiers().contains(Modifier.PUBLIC) && isCanonical(type, method))
						edits.add(new JavaSourceTransformer.Edit(unit.start(tree), unit.start(tree), "public "));
					final String old = type.getSimpleName().toString();
					final String name = nameOf(type);
					if (!old.equals(name)) {
						final int start = Math.max(unit.start(tree), unit.end(tree.getModifiers()));
						edits.add(declaration(unit, start, unit.start(tree.getBody()) + 1, old, name, true));
					}
				}
				return super.visitMethod(tree, unused);
			}

			@Override
			public Void visitTypeParameter(final TypeParameterTree tree, final Void unused) {
				final String name = nameOf(element());
				if (name != null) {
					int start = unit.start(tree);
					for (final AnnotationTree annotation : tree.getAnnotations())
						start = Math.max(start, unit.end(annotation));
					edits.add(declaration(unit, start, unit.end(tree), tree.getName().toString(), name, false));
				}
				return super.visitTypeParameter(tree, unused);
			}

			@Override
			public Void visitVariable(final VariableTree tree, final Void unused) {
				final String name = unit.localNames.get(element());
				if (name != null) {
					final int end = tree.getInitializer() == null ? unit.end(tree) : unit.start(tree.getInitializer());
					final List<MatchResult> beforeValue = tokens(unit.code, unit.start(tree), end).toList();
					final MatchResult declared = beforeValue.reversed().stream().filter(token -> text(token).equals(tree.getName().toString()))
							.findFirst().orElseThrow(() -> new IllegalStateException("Could not identify variable " + tree.getName()));
					edits.add(edit(declared, name));
				}
				return super.visitVariable(tree, unused);
			}

			@Override
			public Void visitIdentifier(final IdentifierTree tree, final Void unused) {
				// var やラムダの引数には javac が推論した型の参照がある。ソース上にある参照だけを書き換える。
				if (!unit.hasSourceRange(tree)) return null;
				final Element symbol = element();
				String replacement = nameOf(symbol);
				final String name = tree.getName().toString();
				if (symbol instanceof TypeElement type) {
					if (replacement != null && unit.needsImportOwner(type, getCurrentPath())) replacement = bundledName(unit, type);
					else if (replacement == null && qualify.contains(name) && !hasEnclosingInstance(getCurrentPath())) replacement = type.getQualifiedName().toString();
				}
				if (replacement != null && !replacement.equals(name))
					edits.add(new JavaSourceTransformer.Edit(unit.start(tree), unit.end(tree), replacement));
				return super.visitIdentifier(tree, unused);
			}

			@Override
			public Void visitMemberSelect(final MemberSelectTree tree, final Void unused) {
				if (!unit.hasSourceRange(tree)) return super.visitMemberSelect(tree, unused);
				if (element() instanceof TypeElement type) {
					final String name = nameOf(type);
					if (name != null && type.getNestingKind() == NestingKind.TOP_LEVEL) {
						shortenedTypeReference = true;
						edits.add(new JavaSourceTransformer.Edit(unit.start(tree), unit.end(tree), name));
						return null;
					}
					if (name != null && !tree.getIdentifier().contentEquals(name))
						edits.add(declaration(unit, unit.end(tree.getExpression()), unit.end(tree), tree.getIdentifier().toString(), name, false));
				} else if (element() instanceof VariableElement variable && !tree.getIdentifier().contentEquals(variableName(unit, variable))) {
					edits.add(declaration(unit, unit.end(tree.getExpression()), unit.end(tree), tree.getIdentifier().toString(), variableName(unit, variable), false));
				}
				return super.visitMemberSelect(tree, unused);
			}
		}.scan(unit.analysis.solution(), null);
		return edits;
	}

	/** outer.new Inner<T>() の Inner は outer のメンバーとして解決される。型引数や注釈内の名前は通常のスコープで解決する。 */
	private static boolean hasEnclosingInstance(TreePath path) {
		while (path.getParentPath() != null) {
			final Tree parent = path.getParentPath().getLeaf();
			if (parent instanceof NewClassTree call) return call.getIdentifier() == path.getLeaf() && call.getEnclosingExpression() != null;
			if (!(parent instanceof ParameterizedTypeTree params && params.getType() == path.getLeaf())
					&& !(parent instanceof AnnotatedTypeTree annotated && annotated.getUnderlyingType() == path.getLeaf())) return false;
			path = path.getParentPath();
		}
		return false;
	}

	static final class Unit {
		final String code;
		final JavaSourceTransformer.Analysis analysis;
		final Map<Element, String> localNames = new HashMap<>();
		private final Set<TypeElement> importedMembers = new HashSet<>();

		Unit(final String code, final JavaSourceTransformer.Analysis analysis) {
			this.code = code;
			this.analysis = analysis;
		}

		/** 所属する型やそのサブクラスの中なら、import を外しても元から単純名で見える。 */
		boolean needsImportOwner(final TypeElement type, final TreePath path) {
			if (!importedMembers.contains(type) || hasEnclosingInstance(path)) return false;
			final var types = analysis.types();
			final TypeMirror owner = types.erasure(type.getEnclosingElement().asType());
			for (TreePath p = path; p != null; p = p.getParentPath())
				if (p.getLeaf() instanceof ClassTree && analysis.trees().getElement(p) instanceof TypeElement enclosing
						&& types.isSubtype(types.erasure(enclosing.asType()), owner)) return false;
			return true;
		}

		boolean hasSourceRange(final Tree tree) {return start(tree) >= 0 && end(tree) >= 0;}

		int start(final Tree tree) {return (int) analysis.positions().getStartPosition(analysis.solution(), tree);}

		int end(final Tree tree) {return (int) analysis.positions().getEndPosition(analysis.solution(), tree);}

		String binary(final TypeElement type) {return analysis.elements().getBinaryName(type).toString();}
	}
}
