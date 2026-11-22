# Keyboard shortcuts

[Back to the feature list](../../README.en.md#4-feature-list) ・ [日本語](keyboard-shortcuts.md)

> Submit, copy samples, switch tasks, open pages and more with keys you choose.

![Shortcut shown on the submit button](../images/keyboard-shortcuts.png)

## How it works

- In the detailed settings, write a key for each action. Join `Ctrl`, `Shift`, `Alt`, `Cmd` and a character or a key such as `Enter`, `Escape` or an arrow (`Left` and so on) with `+` (e.g. `Ctrl+Shift+Enter`, `Alt+S`). Case does not matter.
- On a Mac, `Ctrl` is the control key, `Alt` is the option key and `Cmd` is the command key. You can also write `Option` and `Command`. The default keys combine control and option, so they work on a Mac as they are.
- Write `none` to use no key for that action.
- Every key works whether or not you are in the submission field or the editor. Most actions use three modifier keys so that they do not overlap with the keys of the sites and Easy Test+.
- Letter and digit keys are matched by the position of the key you press, not by the character Shift or other modifiers produce. Write `[` and `]` without Shift even when the key uses Shift (e.g. `Ctrl+Shift+[`).
- For actions that have a button, hover over the button to see the assigned key.

### Submitting and testing

- If you press the submit key while the [submission helper](java-submit.en.md) is transforming pasted code, the code is submitted after the transform finishes.
- Folding folds the innermost block around the cursor (such as `{}` or a comment) that is not folded yet. The unfold key opens the fold on the cursor line. Any language works. This does not work in the yukicoder editor.
- The test keys work on pages where [Easy Test+](easy-test.en.md) is enabled.

### Copying samples and the statement

- Sample inputs and outputs are copied with separate keys. Press the modifiers followed by the sample number (1 to 9). By default, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd> copies sample input 1 and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd> copies sample output 1.
- On the AtCoder submit page, the samples of the selected task are copied.
- Copying the statement copies the same text as “Copy All” of [Copy statement](statement-copy.en.md).

### Switching tasks and opening pages

- The previous and next task keys work on task pages. For the task key, press the modifiers followed by A to Z. The task letters are ignored: A, B, C… count from the top of the task list. Tasks after the 26th cannot be opened.
- Tasks open in the same tab. The task list, my submissions, the standings, the editorial, the custom test and AC submissions open in a new tab so that the current page stays open.
- On a task page, the editorial key opens the editorial of that task. Codeforces has no editorial page, so this key does nothing there.
- AC submissions open the same lists as the [AC submission buttons](submission-shortcuts.en.md). They work even for orders whose button is hidden.
- The post to X opens with the title and URL of the current page. You post it yourself from the opened page.

## Detailed settings

Open this feature’s “Detailed settings” in CP Toolkit.

| Setting                                                                          | Default              |
|----------------------------------------------------------------------------------|----------------------|
| Open the CP Toolkit settings                                                     | Ctrl+I               |
| Submit                                                                           | Ctrl+Shift+Enter     |
| Fold the block at the cursor                                                     | Ctrl+Shift+[         |
| Unfold the fold on the cursor line                                               | Ctrl+Shift+]         |
| Test with Easy Test+, then submit                                                | Ctrl+Enter           |
| Test all samples with Easy Test+                                                 | Alt+Enter            |
| Open or close the Easy Test+ panel                                               | Alt+Escape           |
| Copy a sample input (these modifiers and a number from 1 to 9)                   | Ctrl+Alt             |
| Copy a sample output (these modifiers and a number from 1 to 9)                  | Ctrl+Shift+Alt       |
| Copy the whole statement (AtCoder)                                               | Ctrl+Shift+Alt+P     |
| Open the previous task                                                           | Ctrl+Shift+Alt+Left  |
| Open the next task                                                               | Ctrl+Shift+Alt+Right |
| Open a task (these modifiers and A to Z: A, B, C… from the top of the task list) | Ctrl+Alt             |
| Open the task list                                                               | Ctrl+Shift+Alt+T     |
| Open my submissions                                                              | Ctrl+Shift+Alt+S     |
| Open the standings                                                               | Ctrl+Shift+Alt+R     |
| Open the editorial (AtCoder)                                                     | Ctrl+Shift+Alt+E     |
| Open the custom test                                                             | Ctrl+Shift+Alt+C     |
| Open AC submissions by execution time (AtCoder)                                  | Ctrl+Shift+Alt+F     |
| Open AC submissions by code length (AtCoder)                                     | Ctrl+Shift+Alt+L     |
| Open AC submissions by submission time (AtCoder)                                 | Ctrl+Shift+Alt+N     |
| Open AC submissions by memory (AtCoder)                                          | Ctrl+Shift+Alt+M     |
| Open a post to X for the current page                                            | Ctrl+Shift+Alt+X     |

If several actions share a key, the lower one in the table is tried first, and the upper one runs if the lower one is not available on the page.

## Pages

- AtCoder (including the top page)
- Codeforces
- AOJ
- Library Checker
- paiza
- yukicoder task pages

Copying samples works on task pages of AtCoder, Codeforces and yukicoder. Switching tasks and opening contest pages work on contest pages of AtCoder and Codeforces.
