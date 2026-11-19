# Easy Test+

[Back to the feature list](../../README.en.md#4-feature-list) ・ [日本語](easy-test.md)

> Run sample tests from the task page and submit when they all pass.

**This feature is off by default. Turn it on in the settings.**

![Easy Test+](../images/easy-test.png)

## How it works

Easy Test+ is based on [AtCoder Easy Test v2](https://greasyfork.org/scripts/433152). Enable one or the other to avoid duplicate buttons.

### Running tests and submitting

- Click “Run” beside a sample to test that case, or “Test All Samples” to run them all. Use the bottom panel to enter your own input.
- “Test & Submit” submits once every sample passes. Cancel the pending submission while the tests are running to keep the results without submitting.
- If no samples are found, “Test All Samples” and “Test & Submit” skip testing and submission. You can set a tolerance for comparing output.

### Execution environments

- Options depend on the site and language. They include AtCoder custom tests, Python in the browser, PaizaIO and Wandbox. C++ on Wandbox supports AtCoder Library.
- Code and input go to the selected environment when you run a test. An internal error can trigger a retry, but Easy Test+ never switches to PaizaIO or Wandbox as a fallback.
- AtCoder custom tests run one at a time. In browsers with Web Locks, tests started in other tabs join the same queue.
- Enable [Local Runner integration](local-runner.en.md) to run supported languages on the configured server. When precompilation is on and the server has a compatible environment, Easy Test+ also sends the code as you edit, even when another environment is selected. The bundled runner reports cumulative allocation for Java and peak memory usage for C, C++ and Python.

### Saved code and shortcuts

- Easy Test+ keeps the last code you ran for each task, up to 10 tasks by default. Choose “Restore Last Code” to restore it for the current task.
- Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to test and submit, <kbd>Alt</kbd>+<kbd>Enter</kbd> to test all samples, or <kbd>Alt</kbd>+<kbd>Esc</kbd> to toggle the bottom panel.

## Detailed settings

Open this feature’s “Detailed settings” in CP Toolkit.

| Setting                                        | Default |
|------------------------------------------------|---------|
| Precompile edited code with Local Runner       | On      |
| Use shortcuts (Ctrl+Enter, Alt+Enter, Alt+Esc) | On      |
| Number of tasks to keep code for               | `10`    |
| Allowed error                                  | `1e-6`  |

## Pages

- Task pages
- Submit page
- yukicoder problem pages
- Codeforces problem pages
