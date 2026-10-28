import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Where EMD keeps jobs and run logs. Every `emd` process on the machine shares
// it, so a job started by one process can be read by another. Temporary on
// purpose; `emd gc` will own cleanup. EMD_STATE_DIR overrides it (tests).
export const stateDir = (): string =>
  process.env.EMD_STATE_DIR ?? join(tmpdir(), "emd");

// Where EMD keeps what must outlive a reboot: the ownership ledger, the
// per-worktree build folders and the check counts. EMD_STATE_DIR overrides it.
export const homeDir = (): string =>
  process.env.EMD_STATE_DIR ?? join(homedir(), ".emd");
