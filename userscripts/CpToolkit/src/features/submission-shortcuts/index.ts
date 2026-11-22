import {buildAtCoderSubmissionsQuery, parseAtCoderTaskUrl} from "@atcoder-tools/shared";
import {option} from "@domain/settings/option";
import {defineFeature} from "@application/feature/definition";
import {SHORTCUT_ACTIONS} from "@application/shortcuts/shortcut-actions";
import {h} from "@ui/element";
import {addTooltip} from "@ui/tooltip/tooltip";

/** ボタンにできる並び順。表示するかどうかは詳細設定で選ぶ。 */
const ORDERS = [
	{option: "byTime", orderBy: "time_consumption", label: "submissionShortcuts.time", action: SHORTCUT_ACTIONS.acByTime},
	{option: "byLength", orderBy: "source_length", label: "submissionShortcuts.length", action: SHORTCUT_ACTIONS.acByLength},
	{option: "byCreated", orderBy: "created", label: "submissionShortcuts.created", action: SHORTCUT_ACTIONS.acByCreated},
	{option: "byMemory", orderBy: "memory_consumption", label: "submissionShortcuts.memory", action: SHORTCUT_ACTIONS.acByMemory},
] as const;

export const submissionShortcuts = defineFeature({
	id: "submission-shortcuts",
	title: "submissionShortcuts.title",
	description: "submissionShortcuts.description",
	category: "category.submission",
	defaultEnabled: true,
	routes: ["atcoder:task"],
	phase: "ready",
	options: {
		language: option.text("", "submissionShortcuts.language"),
		byTime: option.boolean(true, "submissionShortcuts.byTime"),
		byLength: option.boolean(true, "submissionShortcuts.byLength"),
		byCreated: option.boolean(true, "submissionShortcuts.byCreated"),
		byMemory: option.boolean(true, "submissionShortcuts.byMemory"),
	},
	live: true,
	start({options, page, translate, shortcuts}) {
		const task = parseAtCoderTaskUrl(location.href);
		const title = document.querySelector(".h2");
		// コンテスト中は他の人の提出を見られないので、終わるまで出さない
		const period = page.contestPeriod();
		if (period && page.serverNow() < period.endMs) return () => undefined;
		if (!task) return () => undefined;
		const urlOf = (orderBy: string): string => {
			const query = buildAtCoderSubmissionsQuery({
				language: options.language || undefined,
				status: "AC",
				orderBy,
				task: task.taskId,
			});
			return `/contests/${task.contestId}/submissions?${query}`;
		};
		// キーで開くときは、表示中の問題を残せるよう新しいタブで開く。ボタンを出さない並び順でも使える
		const unregister = ORDERS.map(({orderBy, action}) => shortcuts.register(action, () => {
			window.open(urlOf(orderBy), "_blank", "noopener");
			return true;
		}));
		const dispose = (): void => {
			for (const remove of unregister) remove();
		};
		const orders = ORDERS.filter((order) => options[order.option]);
		if (!title || orders.length === 0) return dispose;

		const createLink = (label: string, orderBy: string, action: string): HTMLAnchorElement => {
			const link = h("a", {className: "btn btn-default btn-sm", href: urlOf(orderBy), textContent: label});
			addTooltip(() => link, () => shortcuts.keyOf(action));
			return link;
		};

		const label = h("span", {textContent: `${translate("submissionShortcuts.label")}:`});
		label.style.marginRight = "6px";
		const wrapper = h(
			"span",
			{className: "cp-title-control"},
			label,
			h(
				"span",
				{className: "btn-group"},
				...orders.map(({orderBy, label, action}) => createLink(translate(label), orderBy, action)),
			),
		);
		Object.assign(wrapper.style, {
			marginLeft: "16px",
			fontSize: "14px",
			fontWeight: "normal",
			verticalAlign: "middle",
			whiteSpace: "nowrap",
		});
		title.append(wrapper);
		return () => {
			wrapper.remove();
			dispose();
		};
	},
});
