// Browser stubs for the node builtins ssh-config requires. In the browser
// every shell probe must fail fast instead of crashing on a missing API:
//   - Match exec criteria        → spawnSync status != 0 → criterion false
//   - CanonicalDomains lookups   → nslookup status != 0  → give up canonicalizing
// os.userInfo feeds Match user/localuser criteria — a fixed value keeps them
// inert instead of throwing.

export const spawnSync = (): { status: number; stdout: string; stderr: string } => ({
  status: 1,
  stdout: "",
  stderr: "",
});

export const userInfo = (): { username: string } => ({ username: "browser" });
export const hostname = (): string => "localhost";
export const EOL = "\n";
export const type = (): string => "Browser";

const childProcess = { spawnSync };
const os = { userInfo, hostname, EOL, type };

export default { spawnSync, userInfo, hostname, EOL, type, childProcess, os };
