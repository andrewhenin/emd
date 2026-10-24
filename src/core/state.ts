import { tmpdir } from "node:os";
import { join } from "node:path";

// Where EMD keeps jobs and run logs. Every `emd` process on the machine shares
// it, so a job started by one process can be read by another. Temporary on
// purpose; `emd gc` will own cleanup. EMD_STATE_DIR overrides it (tests).
export const stateDir = (): string =>
  process.env.EMD_STATE_DIR ?? join(tmpdir(), "emd");
