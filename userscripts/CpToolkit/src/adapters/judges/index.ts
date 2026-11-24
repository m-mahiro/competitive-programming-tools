import type {JudgeSite} from "@application/ports/judge-site";
import type {PageBridge} from "@application/ports/page-bridge";
import type {HttpClient} from "@application/ports/services";
import {AtCoderSite} from "./atcoder";
import type {TestCase} from "@domain/execution/result";
import {CodeforcesMobileSite, CodeforcesSite, readCodeforcesSamples} from "./codeforces";
import {YukicoderSite} from "./yukicoder";

const CODEFORCES_MOBILE_HOST = /^m[1-3]\.codeforces\.com$/;

export async function createJudgeSite(
	judgeId: string | undefined,
	bridge: PageBridge,
	site: HttpClient,
): Promise<JudgeSite | null> {
	switch (judgeId) {
		case "atcoder":
			return new AtCoderSite(bridge, site);
		case "yukicoder":
			return new YukicoderSite(bridge);
		case "codeforces":
			if (CODEFORCES_MOBILE_HOST.test(location.host)) return CodeforcesMobileSite.create(bridge);
			return new CodeforcesSite(bridge);
		default:
			return null;
	}
}

/**
 * 表示中の問題の入出力例。Codeforces はサイトの操作を作ると提出欄に入力欄を足すので、ページから直接読む。
 * AtCoder の提出ページのように問題文が無いページでは、サイトの操作に任せる。
 */
export async function readPageSamples(
	judgeId: string | undefined,
	judgeSite: () => Promise<JudgeSite | null>,
): Promise<readonly TestCase[]> {
	if (judgeId === "codeforces") {
		return readCodeforcesSamples(document, CODEFORCES_MOBILE_HOST.test(location.host));
	}
	const site = await judgeSite();
	return site ? await site.samples() : [];
}
