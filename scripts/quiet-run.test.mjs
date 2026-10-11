import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const runner = resolve('scripts/quiet-run.mjs');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vir-quiet-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function run(args, { cwd, execArgv = [] } = {}) {
  const child = spawn(process.execPath, [...execArgv, runner, ...args], { cwd });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, done };
}
test('success captures both streams and prints one line', async t => {
  const log = join(await fixture(t), 'nested', 'out.log');
  const result = await run(['--log', log, '--', process.execPath, '-e', 'console.log("out"); console.error("err")']).done;
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.equal(result.stderr, '');
  assert.match(await readFile(log, 'utf8'), /out/);
  assert.match(await readFile(log, 'utf8'), /err/);
});
test('independent PID namespaces and identical clocks cannot share default logs', async t => {
  const cwd = await fixture(t);
  const preload = 'const D=Date;globalThis.Date=class extends D{constructor(...args){super(...(args.length?args:["2026-10-10T08:52:26.320Z"]))}};Object.defineProperty(process,"pid",{value:14});';
  const execArgv = ['--import', `data:text/javascript,${encodeURIComponent(preload)}`];
  const results = await Promise.all(['first', 'second'].map(marker =>
    run(['--', process.execPath, '-e', `console.log(${JSON.stringify(marker)})`], { cwd, execArgv }).done));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  const logs = results.map(result => resolve(cwd, result.stdout.trim().match(/; log: (.+)$/)[1]));
  assert.notEqual(logs[0], logs[1]);
  assert.equal(await readFile(logs[0], 'utf8'), 'first\n');
  assert.equal(await readFile(logs[1], 'utf8'), 'second\n');
});
test('default log reservation cannot overwrite an existing log or start the command', async t => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'build', 'logs'), { recursive: true });
  const file = join(cwd, 'build', 'logs', '2026-10-10T08-52-26-320Z-14-fixed-node.log');
  await writeFile(file, 'retained evidence\n');
  const preload = 'import crypto from "node:crypto";import {syncBuiltinESMExports} from "node:module";crypto.randomUUID=()=>"fixed";syncBuiltinESMExports();const D=Date;globalThis.Date=class extends D{constructor(...args){super(...(args.length?args:["2026-10-10T08:52:26.320Z"]))}};Object.defineProperty(process,"pid",{value:14});';
  const marker = join(cwd, 'started');
  const result = await run(['--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`], {
    cwd, execArgv: ['--import', `data:text/javascript,${encodeURIComponent(preload)}`],
  }).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(await readFile(file, 'utf8'), 'retained evidence\n');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
test('failure preserves exit code and bounds displayed tail', async t => {
  const log = join(await fixture(t), 'out.log');
  const result = await run(['--log', log, '--tail', '2', '--', process.execPath, '-e', 'console.log("one\\ntwo\\nthree");process.exitCode=7']).done;
  assert.equal(result.code, 7);
  assert.match(result.stderr, /two\nthree/);
  assert.doesNotMatch(result.stderr, /\none\n/);
  assert.equal(await readFile(log, 'utf8'), 'one\ntwo\nthree\n');
});
test('spawn error is diagnosed', async t => {
  const log = join(await fixture(t), 'out.log');
  const result = await run(['--log', log, '--', join(tmpdir(), 'vir-nonexistent-command')]).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ENOENT/);
});
test('command help arguments are passed through, not interpreted by the wrapper', async t => {
  const log = join(await fixture(t), 'out.log');
  const result = await run(['--log', log, '--', process.execPath, '-e', 'console.log(process.argv[1])', '--', '--help']).done;
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^ok:/);
  assert.equal(await readFile(log, 'utf8'), '--help\n');
});
test('log open failure does not start the command', async t => {
  const dir = await fixture(t);
  const marker = join(dir, 'started');
  const result = await run(['--log', dir, '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`]).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /log/i);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
test('log write failure stops the command', { skip: process.platform !== 'linux' }, async () => {
  const result = await run(['--log', '/dev/full', '--', process.execPath, '-e', 'setInterval(()=>console.log("output"),10)']).done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /ENOSPC/);
});
for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} stops command and grandchild, including a signal-resistant child`, { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const dir = await fixture(t);
  const log = join(dir, 'out.log');
  const code = `const {spawn}=require('child_process');process.on(${JSON.stringify(signal)},()=>{});const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`;
  const { child, done } = run(['--log', log, '--', process.execPath, '-e', code]);
  let pids;
  t.after(() => {
    for (const pid of pids ?? []) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    try { child.kill('SIGKILL'); } catch {}
  });
  for (let n = 0; n < 100; n++) {
    try { pids = JSON.parse((await readFile(log, 'utf8')).trim()); break; } catch {}
    await delay(20);
  }
  assert.ok(pids, 'command reached ready state');
  child.kill(signal);
  const result = await done;
  assert.equal(result.code, signal === 'SIGINT' ? 130 : 143);
  for (const pid of pids) {
    // Linux may briefly retain an orphan zombie; it is no longer executing.
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      assert.match(stat.slice(stat.lastIndexOf(')') + 2), /^Z /);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});
