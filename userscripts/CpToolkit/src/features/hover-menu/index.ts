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
		// ボタンのクリックで開閉するので、重ねたときと離したときにそのクリックを起こす
		for (const wrapper of document.querySelectorAll(".j-dropdown_mypage")) {
			const button = wrapper.querySelector<HTMLElement>(".header-mypage_btn");
			if (!button) continue;
			wrapper.addEventListener("mouseenter", () => {
				if (!button.classList.contains(ACTIVE_CLASS)) button.click();
			}, {signal});
			wrapper.addEventListener("mouseleave", () => {
				if (button.classList.contains(ACTIVE_CLASS)) button.click();
			}, {signal});
		}
		return () => controller.abort();
	},
});
