import {beforeEach} from "bun:test";
import {GlobalRegistrator} from "@happy-dom/global-registrator";
import {clearShortcuts} from "@ui/shortcuts";
import {clearTooltips} from "@ui/tooltip/tooltip";

const INITIAL_URL = "https://atcoder.jp/contests/abc420/tasks/abc420_a";

GlobalRegistrator.register({url: INITIAL_URL});

// テストファイルの実行順は OS によって変わるので、前のテストの DOM、保存した値、URL を持ち越さない
beforeEach(() => {
	document.head.replaceChildren();
	document.body.replaceChildren();
	localStorage.clear();
	history.replaceState(null, "", INITIAL_URL);
	// キー操作とツールチップの登録はページ全体で1つなので、前のテストの登録を持ち越さない
	clearShortcuts();
	clearTooltips();
});
