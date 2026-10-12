// 浏览器对照的临时页面；运行前生成，完成后清理，避免随静态站点部署。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ref = 'a1f15d596da626be30800b60b2ba636f463c36a4';
const baseline = execFileSync('git', ['-c', `safe.directory=${root}`, 'show', `${ref}:index.html`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const targets = [path.join(root, 'optimization-baseline.html'), path.join(root, 'scripts', 'optimization-baseline.js')];
const isBaseline = bytes => bytes.equals(baseline) || bytes.toString('utf8').replace(/\r?\n$/, '') === baseline.toString('utf8').replace(/\r?\n$/, '');
for (const target of targets) {
  if (!target.startsWith(root + path.sep)) throw Error('临时文件不在当前仓库内');
  if (fs.existsSync(target) && !isBaseline(fs.readFileSync(target))) throw Error(`保留未知文件：${target}`);
}
for (const target of targets) {
  if (process.argv.includes('--clean')) { if (fs.existsSync(target)) fs.unlinkSync(target); }
  else fs.writeFileSync(target, baseline);
}
console.log(process.argv.includes('--clean') ? '基线临时页面已清理' : `基线临时页面已生成：${ref}`);
