import {defineFeature} from "@application/feature/definition";

const OPEN_CLASS = "open";
const ACTIVE_CLASS = "active";

export const hoverMenu = defineFeature({
	id: "hover-menu",
	title: "hoverMenu.title",
	description: "hoverMenu.description",
	category: "category.layout",
	defaultEnabled: true,
	routes: ["atcoder:page"],
	phase: "ready",
	options: {},
	live: true,
	start() {
		const controller = new AbortController();
		const {signal} = controller;
		for (const item of document.querySelectorAll(".nav > li:not(.pull-right)")) {
			item.addEventListener("mouseenter", () => item.classList.add(OPEN_CLASS), {signal});
			item.addEventListener("mouseleave", () => item.classList.remove(OPEN_CLASS), {signal});
		}
		// 新しいヘッダー(ホーム、コンテスト一覧、ユーザーページなど)のユーザーメニューは、
		// ボタンとメニュー本体の両方に active が付くと開く
		for (const wrapper of document.querySelectorAll(".j-dropdown_mypage")) {
			const parts = wrapper.querySelectorAll(".header-mypage_btn, .header-mypage_detail");
			wrapper.addEventListener("mouseenter", () => parts.forEach(part => part.classList.add(ACTIVE_CLASS)), {signal});
			wrapper.addEventListener("mouseleave", () => parts.forEach(part => part.classList.remove(ACTIVE_CLASS)), {signal});
		}
		return () => controller.abort();
	},
});
