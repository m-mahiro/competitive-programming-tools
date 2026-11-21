# Submission helper

[Back to the feature list](../../README.en.md#4-feature-list) ・ [日本語](java-submit.md)

> Prepare pasted code for submission and submit with a keyboard shortcut.

![Notification for imports that could not be found](../images/java-submit-imports.png)

## How it works

- Pasting a complete solution transforms it into a form that can be submitted. Pasting part of the code into the editor leaves the code unchanged.
- With [Local Runner integration](local-runner.en.md), the code is transformed with the Local Runner language that matches the language selected on the page. Local Runner's settings decide what is done: expanding libraries and renaming the class to `Main` for Java, and running `bundle` and rewriting a debug variable for other languages.
- On AtCoder and Codeforces, the language comes from the language selector on the page. On AOJ, paiza and Library Checker, the code is transformed only when the editor reports Java.
- Without Local Runner, only a basic transform for each language is applied. Java is the only such language for now.
- The submission header is added by [Code header and footer](source-comments.en.md).
- If Local Runner cannot transform the code, the code is left unchanged and a notification shows the imports that could not be found, or the first error for other errors. Open “Full diagnostics” in the notification to read all of them.
- Shortcuts submit the code: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> on AtCoder and Codeforces, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> on AOJ and paiza, and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> on Library Checker.

![Shortcut shown on the submit button](../images/java-submit-shortcut.png)

## Java

- Without Local Runner, the package declaration is removed and the class is renamed to `Main`. This only replaces text and is not guaranteed to be correct. The class is renamed only when exactly one top-level type has `main` and no other `Main` exists. Use Local Runner for a reliable transform.
- A debug variable is changed only when you set its name in the detailed settings, and only a `boolean name = true` declaration directly in the class that runs is set to `false`. With Local Runner, its `debugFlag` setting decides what is rewritten.
- If you set the library package (e.g. `lib`) in the detailed settings, pasting code that imports it while Local Runner is unreachable shows a notification with a link to the setup steps. Submitting that code as it is causes a compile error.
- Classes and comments are folded when the transformed code is applied to the editor. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> also folds them.

## Detailed settings

Open this feature’s “Detailed settings” in CP Toolkit.

| Setting                                                        | Default |
|----------------------------------------------------------------|---------|
| Java variable to set to false when Local Runner is unavailable | (empty) |
| Package of the Java library that Local Runner expands          | (empty) |
| Fold Java classes and comments after pasting                   | On      |

## Pages

- Task pages
- Submit page
- Custom test page
- Codeforces
- AOJ
- Library Checker
- paiza
