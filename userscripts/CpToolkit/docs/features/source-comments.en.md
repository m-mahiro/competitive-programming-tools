# Code header and footer

[Back to the feature list](../../README.en.md#4-feature-list) ・ [日本語](source-comments.md)

> Add a saved header and footer when you paste a complete solution.

<p><img src="../images/source-comments.png" alt="Code header and footer"><br><sub>Registered text added at the beginning and end of the code.</sub></p>

## How it works

- Adds comments you put in every solution, such as attached reference URLs, automatically.
- Open the input screen from the "Header and footer" button near the editor or submit button. The button changes color when it has content.
- The header and the footer each have "Use a multi-line comment". Without it, single-line comments are used. The initial state follows "Default comment style" in the detailed settings.
- When pasting replaces the whole code, the header is added to the top and the footer to the bottom. Pasting part of the code adds nothing.
- The content is saved when you leave the input field and is used for the next task too. Choose "This task only" to save it for that task alone.
- Saved content can be loaded with "Restore from history", which keeps the latest 20 entries. Content saved with "Save with a name" stays until you delete it.
- Changing the language also switches the comment syntax. Once you edit the inserted part, it is no longer rewritten.
- Without "Comment out when inserting", the text is inserted as written, so write the comment markers yourself.
- `{url}`, `{task}` and `{contest}` become the task URL, the task ID and the contest ID.
- For languages whose comment syntax is unknown, nothing is inserted and a notification tells you so.
- If a header is set in Local Runner, a full paste adds the selected language’s header above the task header. In the detailed settings, put it below the task header or leave it out. A matching block at that position appears once. Matching lines in the body are preserved. Editing or changing the language discards a pending response. [Local Runner integration](local-runner.en.md)
- If you enter a header name in the detailed settings, the header saved under that name is used instead of the language default. A notification tells you if no header has that name.

## Detailed settings

Open this feature’s “Detailed settings” in CP Toolkit.

| Setting                                                   | Default               |
|-----------------------------------------------------------|-----------------------|
| Default comment style                                     | Single-line comments  |
| Where to put the Local Runner header                      | Above the task header |
| Local Runner header name (empty for the language default) | (empty)               |

## Pages

- AtCoder task, submission and custom test pages
- yukicoder problem pages
- Codeforces, AOJ, Library Checker and paiza pages with a submission editor
