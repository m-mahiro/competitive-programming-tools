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
	/**
	 * どこかで変数、型パラメーター、入れ子の型の名前に使われている名前と、継承して見える入れ子の型とフィールドの名前。
	 * 展開でライブラリの型を完全修飾名なしで書くと、これらに隠されてしまうので、同じ名前のライブラリの型は別の名前にする。
	 */
	private final Set<String> shadowingNames = new HashSet<>();
	private final Set<String> topLevelNames = new HashSet<>();
	private final Map<String, String> typeNames = new HashMap<>();
	private final Map<String, String> binaryNames = new HashMap<>();
	private final Map<String, String> fieldNames = new HashMap<>();
	private final Map<String, Set<String>> candidates = new HashMap<>();
	private final Set<String> qualify = new HashSet<>();
	private final TypeElement entry;
	private final Map<String, Integer> nextSuffix = new HashMap<>();

	JavaBundleNames(final List<Unit> units, final TypeElement entry) {
		this.units = units;
		this.entry = entry;
		for (final Unit unit : units) collectNames(unit);
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
		return units.size() > 1 || !entry.getSimpleName().contentEquals("Main") || !nextSuffix.isEmpty() || units.getFirst().analysis.hasErrors();
	}

	private void collectNames(final Unit unit) {
		new TreePathScanner<Void, Void>() {
			@Override
			public Void scan(final Tree node, final Void unused) {
				if (node instanceof ClassTree tree) reserved.add(tree.getSimpleName().toString());
				if (node instanceof VariableTree tree) {
					reserved.add(tree.getName().toString());
					shadowingNames.add(tree.getName().toString());
				}
				if (node instanceof TypeParameterTree tree) {
					reserved.add(tree.getName().toString());
					shadowingNames.add(tree.getName().toString());
				}
				if (node instanceof IdentifierTree tree) reserved.add(tree.getName().toString());
				return super.scan(node, unused);
			}

			@Override
			public Void visitClass(final ClassTree node, final Void unused) {
				// 入れ子の型の名前は、その外側の型の中で同じ名前のライブラリの型を隠す
				if (!(getCurrentPath().getParentPath().getLeaf() instanceof CompilationUnitTree))
					shadowingNames.add(node.getSimpleName().toString());
				// Thread を継承した型の中では、State が Thread.State を指す
				if (unit.analysis.trees().getElement(getCurrentPath()) instanceof TypeElement type)
					collectInheritedNames(unit, type.asType(), new HashSet<>());
				return super.visitClass(node, unused);
			}

			private void remember() {
				if (unit.analysis.trees().getElement(getCurrentPath()) instanceof TypeElement type)
					candidates.computeIfAbsent(type.getSimpleName().toString(), key -> new HashSet<>()).add(unit.binary(type));
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

	/** 上位の型から継承して、単純名で見える入れ子の型とフィールドの名前を集める。 */
	private void collectInheritedNames(final Unit unit, final TypeMirror type, final Set<String> visited) {
		for (final TypeMirror parent : unit.analysis.types().directSupertypes(type)) {
			if (!(parent instanceof DeclaredType declared) || !(declared.asElement() instanceof TypeElement element)
					|| !visited.add(unit.binary(element)))
				continue;
			for (final Element member : element.getEnclosedElements()) {
				final ElementKind kind = member.getKind();
				if (!member.getModifiers().contains(Modifier.PRIVATE) && (kind.isClass() || kind.isInterface() || kind.isField()))
					shadowingNames.add(member.getSimpleName().toString());
			}
			collectInheritedNames(unit, parent, visited);
		}
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
				else if (old.equals("Main") || topLevel && topLevelNames.contains(old)) name = nextName(old);
				// 展開ではライブラリの型を完全修飾名なしで書くので、同じ名前の変数、型パラメーター、入れ子の型があると、そちらを指してしまう
				// (int Helper と mine.Helper.tag()、<Helper> と mine.Helper.tag()、Thread を継承した型の中の mine.State.tag())
				else if (topLevel && unit != units.getFirst() && shadowingNames.contains(old)) name = nextName(old);
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

	/**
	 * static import で使えるメンバーなら、宣言した型の正規名を返す。ライブラリのファイルの static import は先頭へ集めないので、
	 * javac が解決した宣言元の型で修飾する。静的なメンバーを宣言元の型で修飾しても、指す宣言は変わらない。
	 */
	private static String staticImportOwner(final Unit unit, final Element symbol, final TreePath path) {
		// enum の switch の case ラベルは、static import ではなく switch の型から決まる。修飾は Java 21 からしか書けない
		final Tree parent = path.getParentPath() == null ? null : path.getParentPath().getLeaf();
		if (symbol != null && symbol.getKind() == ElementKind.ENUM_CONSTANT && (parent instanceof CaseTree || parent instanceof ConstantCaseLabelTree))
			return null;
		if (unit.staticImports.isEmpty() || symbol == null || !symbol.getModifiers().contains(Modifier.STATIC)
				|| !(symbol.getEnclosingElement() instanceof TypeElement owner))
			return null;
		final String type = owner.getQualifiedName().toString();
		final String name = symbol.getSimpleName().toString();
		return unit.staticImports.contains(type + "." + name) || unit.staticImports.contains(type + ".*") ? type : null;
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
				// 展開では、この名前を宣言元の型で修飾する(edits)。修飾した型の参照も、展開後と同じ順に数える。
				final Element element = unit.analysis.trees().getElement(getCurrentPath());
				if (original && !(element instanceof TypeElement) && staticImportOwner(unit, element, getCurrentPath()) != null)
					result.add("type " + owner((TypeElement) element.getEnclosingElement()));
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
				final Element symbol = element();
				final String imported = staticImportOwner(unit, symbol, getCurrentPath());
				if (imported != null && unit.end(tree) >= 0) {
					edits.add(new JavaSourceTransformer.Edit(unit.start(tree), unit.end(tree), imported + "." + tree.getName()));
					return super.visitIdentifier(tree, unused);
				}
				String replacement = nameOf(symbol);
				final String name = tree.getName().toString();
				if (replacement == null && symbol instanceof TypeElement type && qualify.contains(name))
					replacement = type.getQualifiedName().toString();
				if (replacement != null && !replacement.equals(name) && unit.end(tree) >= 0)
					edits.add(new JavaSourceTransformer.Edit(unit.start(tree), unit.end(tree), replacement));
				return super.visitIdentifier(tree, unused);
			}

			@Override
			public Void visitMemberSelect(final MemberSelectTree tree, final Void unused) {
				if (element() instanceof TypeElement type) {
					final String name = nameOf(type);
					if (name != null && type.getNestingKind() == NestingKind.TOP_LEVEL) {
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

	static final class Unit {
		final String code;
		final JavaSourceTransformer.Analysis analysis;
		final Map<Element, String> localNames = new HashMap<>();
		/** 先頭へ集めずに、使う側を修飾する static import の名前(java.lang.Math.max、java.lang.Math.* など)。 */
		final Set<String> staticImports = new HashSet<>();

		Unit(final String code, final JavaSourceTransformer.Analysis analysis) {
			this.code = code;
			this.analysis = analysis;
		}

		int start(final Tree tree) {return (int) analysis.positions().getStartPosition(analysis.solution(), tree);}

		int end(final Tree tree) {return (int) analysis.positions().getEndPosition(analysis.solution(), tree);}

		String binary(final TypeElement type) {return analysis.elements().getBinaryName(type).toString();}
	}
}
