/** programId の形(ソースの長さの16進数-md5)か。外から受け取った値を、作業フォルダのパスに使う前に確かめる。 */
export function isProgramId(value: string): boolean {
	return /^[0-9a-f]+-[0-9a-f]{32}$/.test(value);
}

type ProgramCacheOptions<T> = {
	/** 覚える数の上限。 */
	readonly limit: () => number;
	/** 覚えた結果がまだ使えるか。作業フォルダのファイルが消えていれば false を返し、作り直させる。 */
	readonly usable: (program: T) => boolean;
	/** 上限を超えて追い出した結果の後始末(作業フォルダを消すなど)。 */
	readonly evict: (program: T) => void;
};

/**
 * コンパイルしたプログラムを、使った順に上限の数まで覚える。同じプログラムの作成は、終わる前に頼まれても1回にまとめる。
 * 覚えていても、作業フォルダのファイルが消えて使えなければ、覚えた結果を捨てて作り直す。
 * 作成が例外で終われば覚えず、次に頼まれたときにやり直す。
 */
export class ProgramCache<T> {
	private readonly programs = new Map<string, {promise: Promise<T>; value?: T}>();
	private readonly users = new Map<string, number>();
	private readonly options: ProgramCacheOptions<T>;

	constructor(options: ProgramCacheOptions<T>) {
		this.options = options;
	}

	get size(): number {
		return this.programs.size;
	}

	/** id のプログラム。覚えていないか、使えなくなっていれば create で作る。hit は覚えていた結果を使ったときに呼ぶ。 */
	async get(id: string, create: () => Promise<T>, hit?: () => void): Promise<T> {
		for (; ;) {
			const cached = this.recent(id);
			if (cached === undefined) return this.start(id, create());
			const program = await cached.promise;
			if (this.options.usable(program)) {
				hit?.();
				return program;
			}
			// ほかの呼び出しが先に捨てて作り直していれば、次の周でその結果を待つ
			if (this.programs.get(id) === cached) this.programs.delete(id);
		}
	}

	/** id のプログラムを覚えているか。作成中のものも含む。使えるかは確かめない。 */
	has(id: string): boolean {
		return this.programs.has(id);
	}

	/** 覚えている id のプログラム。覚えていないか、使えなくなっていれば null。 */
	async find(id: string): Promise<T | null> {
		const cached = this.recent(id);
		if (cached === undefined) return null;
		const program = await cached.promise;
		return this.options.usable(program) ? program : null;
	}

	/** 順番待ちも含め、同じ id を使う実行がすべて終わるまで作業フォルダを保持する。 */
	async use<R>(id: string, run: (program: T) => Promise<R>, restore?: () => Promise<T | null>): Promise<R | null> {
		this.users.set(id, (this.users.get(id) ?? 0) + 1);
		try {
			const program = await this.find(id) ?? await restore?.();
			return program == null ? null : await run(program);
		} finally {
			const remaining = this.users.get(id)! - 1;
			if (remaining > 0) this.users.set(id, remaining);
			else {
				this.users.delete(id);
				this.trim();
			}
		}
	}

	/** 準備でも実行でも、使ったものを追い出す順番の最後に回す。 */
	private recent(id: string) {
		const entry = this.programs.get(id);
		if (entry) {
			this.programs.delete(id);
			this.programs.set(id, entry);
		}
		return entry;
	}

	private async start(id: string, promise: Promise<T>): Promise<T> {
		const entry: {promise: Promise<T>; value?: T} = {promise};
		this.programs.set(id, entry);
		try {
			entry.value = await promise;
		} catch (error) {
			this.programs.delete(id);
			throw error;
		}
		this.trim();
		return entry.value;
	}

	/** 完成した未使用のプログラムだけを上限まで残す。作成中や実行中のものは次回の候補にする。 */
	private trim(): void {
		const limit = this.options.limit();
		if (this.programs.size <= limit) return;
		const idle = [...this.programs].filter(([id, entry]) => entry.value !== undefined && !this.users.has(id));
		for (const [id, entry] of idle.slice(0, Math.max(0, idle.length - limit))) {
			this.programs.delete(id);
			this.options.evict(entry.value!);
		}
	}
}
