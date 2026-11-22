// 画面を操作するテストで使う共通の部品。

/** 非同期の処理が進むのを待つ。 */
export const wait = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** CP Toolkit が body の直下に作った Shadow DOM。 */
export const shadowRoots = (): ShadowRoot[] => [...document.body.children].flatMap((element) => element.shadowRoot ?? []);

/** ブラウザと同じく、AltGr は altGraph を指定したときだけ押したことにする(テストの DOM は Alt を AltGr とみなす)。 */
export const pressKey = (key: string, {altGraph = false, ...modifiers}: KeyboardEventInit & {altGraph?: boolean} = {}, target: EventTarget = document.body) => {
	const event = new KeyboardEvent("keydown", {key, bubbles: true, ...modifiers});
	const original = event.getModifierState.bind(event);
	Object.defineProperty(event, "getModifierState", {value: (name: string) => name === "AltGraph" ? altGraph : original(name)});
	target.dispatchEvent(event);
};

export const hover = (element: Element | null | undefined) => {
	element?.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
};

/** 表示中のツールチップの文。表示していなければ null。 */
export const tooltipText = () => {
	const tooltip = shadowRoots().flatMap((root) => root.querySelector<HTMLElement>(".tooltip") ?? [])[0];
	return tooltip && !tooltip.hidden ? tooltip.textContent : null;
};
