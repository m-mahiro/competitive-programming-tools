# Java submission helper

[Back to the feature list](../../README.en.md#4-feature-list) ・ [日本語](java-submit.md)

> Prepare pasted Java code for submission and submit with a keyboard shortcut.

## How it works

- Pasting a complete Java solution transforms it into a form that can be submitted. Pasting part of the code into the editor leaves the code unchanged.
- Removing the package declaration, renaming the class to `Main` and turning off a debug variable work without [Local Runner integration](local-runner.en.md). Without Local Runner, however, the transform only replaces text and is not guaranteed to be correct. The class is renamed only when exactly one top-level type has `main` and no other `Main` exists. A debug variable is changed only when you set its name in the detailed settings, and only a `boolean name = true` declaration directly in the class that runs is set to `false`. Use Local Runner for a reliable transform. With Local Runner, its `debugFlag` setting decides what is rewritten.
- Expanding `lib.*` (`setlib`) and adding a submission header (`setheader`) need Local Runner and its settings.
- If Local Runner cannot transform the code, the code is left unchanged and a notification shows the imports that could not be found, or the first lines of the javac diagnostics for other errors.
- If you set the library package (e.g. `lib`) in the detailed settings, pasting code that imports it while Local Runner is unreachable shows a notification with a link to the setup steps. Submitting that code as it is causes a compile error.
- Shortcuts submit the code: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> on AtCoder and Codeforces, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> on AOJ and paiza, and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> on Library Checker.
- Classes and comments are folded when transformed Java code is applied to the editor. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> also folds them.

## Detailed settings

Open this feature’s “Detailed settings” in CP Toolkit.

| Setting                                                      | Default |
|--------------------------------------------------------------|---------|
| Remove package declarations when Local Runner is unavailable | On      |
| Rename the class to Main when Local Runner is unavailable    | On      |
| Variable to set to false when Local Runner is unavailable    | (empty) |
| Package of the library that Local Runner expands             | (empty) |
| Add the submission header                                    | On      |
| Header name (empty for the default)                          | (empty) |
| Fold classes and comments after pasting                      | On      |

## Pages

- Task pages
- Submit page
- Custom test page
- Codeforces
- AOJ
- Library Checker
- paiza
