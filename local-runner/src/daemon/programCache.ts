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
	private readonly programs = new Map<string, Promise<T>>();
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
			const cached = this.programs.get(id);
			if (cached === undefined) return this.start(id, create());
			// 使ったものを追い出す順番の最後に回す
			this.programs.delete(id);
			this.programs.set(id, cached);
			const program = await cached;
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
		const cached = this.programs.get(id);
		if (cached === undefined) return null;
		const program = await cached;
		return this.options.usable(program) ? program : null;
	}

	private start(id: string, program: Promise<T>): Promise<T> {
		this.programs.set(id, program);
		void program.catch(() => {
			if (this.programs.get(id) === program) this.programs.delete(id);
		});
		while (this.programs.size > this.options.limit()) {
			const [oldestId, oldest] = this.programs.entries().next().value!;
			this.programs.delete(oldestId);
			oldest.then(this.options.evict, () => undefined);
		}
		return program;
	}
}
