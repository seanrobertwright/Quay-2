import { attach, inv, terminals, sleep, Q } from "./drv.mjs";
const nodeDir = process.execPath.replace(/\\[^\\]+$/, "");
const PATH = ["C:/scratch/q711\\bin", "C:\\Windows\\System32", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0", nodeDir].join(";");
const { browser, page } = await attach();
for (const t of await terminals(page))
  await inv(page, "kill_terminal", { terminalId: t.id }).catch((e) => console.log(String(e)));
if ((await terminals(page)).length < 2)
  for (const name of ["agent-a", "agent-b"]) {
    await inv(page, "spawn_terminal", { request: { name, project_path: "C:/scratch/q711\\scratch711", run_kind: "gemini", permission_mode: "normal", rows: 30, cols: 100, env_vars: { PATH } } }).catch((e) => console.log("spawn", String(e)));
    await sleep(1500);
  }
console.log(JSON.stringify((await terminals(page)).map((t) => [t.id, t.name, t.run_kind])));
console.log(JSON.stringify(await page.evaluate(() => ({ ...localStorage }))));
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/companion.*width/i.test(k)) localStorage.removeItem(k); });
await page.reload();
await sleep(3000);
for (const t of await terminals(page)) {
  // Each pane needs its xterm mounted once, to answer ConPTY's cursor query
  await page.getByText(t.name, { exact: true }).first().click();
  await sleep(2500);
}
await page.screenshot({ path: `${Q}/out/s1.png` });
await browser.close();
