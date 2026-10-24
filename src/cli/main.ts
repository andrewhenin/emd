import { detect, version } from "../core/index.js";

export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
      console.log(`emd ${version()}`);
      return 0;
    case "detect":
      console.log(JSON.stringify(await detect(args[0])));
      return 0;
    default:
      console.error(
        `emd: unknown command "${command}". Commands: detect [dir]`,
      );
      return 2;
  }
}
