import type {
	Clipboard,
	HttpClient,
	HttpRequest,
	HttpResponse,
	Notification,
	Notifier,
} from "@application/ports/services";

export class GmClipboard implements Clipboard {
	write(text: string): void {
		GM_setClipboard(text);
	}
}

/** 指定しないと閉じるまで残るので、画面の内側の通知と同じ程度で閉じる。 */
const NOTIFICATION_TIMEOUT_MS = 10_000;

export class GmNotifier implements Notifier {
	notify({title, text, url, tag}: Notification): void {
		GM_notification({
			title,
			text,
			timeout: NOTIFICATION_TIMEOUT_MS,
			...(tag !== undefined && {tag}),
			// 通知のクリックはページの操作ではないので、window.open だとブロックされる
			...(url !== undefined && {onclick: () => GM_openInTab(url, {active: true})}),
		});
	}
}

/** ページの CORS や Local Network Access の制限を受けない通信。Cookie は送らない。 */
export class GmHttpClient implements HttpClient {
	send({url, method = "GET", headers, body, timeoutMs}: HttpRequest): Promise<HttpResponse> {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				url,
				method,
				anonymous: true,
				...(headers && {headers: {...headers}}),
				...(body !== undefined && {data: body}),
				...(timeoutMs !== undefined && {timeout: timeoutMs}),
				onload: ({status, responseText}) => resolve({status, text: responseText}),
				onerror: () => reject(new Error(`Request failed: ${url}`)),
				ontimeout: () => reject(new Error(`Request timed out: ${url}`)),
			});
		});
	}
}
