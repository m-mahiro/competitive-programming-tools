import packageJson from "../package.json";

/** Local Runner のバージョン。実行ファイルにはビルドの時点の値が入る。 */
export const VERSION: string = packageJson.version;
