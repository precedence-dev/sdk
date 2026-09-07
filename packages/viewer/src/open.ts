import { execFile } from "child_process";

/** Best-effort "open this in the default browser". A file path or an http URL. */
export function openInBrowser(target: string): void {
  const cmd = process.platform === "win32" ? { file: "cmd", args: ["/c", "start", "", target] }
    : process.platform === "darwin" ? { file: "open", args: [target] }
    : { file: "xdg-open", args: [target] };
  execFile(cmd.file, cmd.args, (err) => {
    if (err) process.stderr.write(`note: could not open a browser (${err.message})\n`);
  });
}
