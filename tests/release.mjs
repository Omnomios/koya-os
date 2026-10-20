import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'koya-release-test-'));
const version = '2026.10.20-12.1-abcdef0', image = `koya-installer-${version}-x86_64.iso`;
const bytes = Buffer.from('Koya live image fixture\n'.repeat(5));
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  const source = path.join(work, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, image), bytes);
  fs.writeFileSync(path.join(source, image + '.sha256'), `${hash(bytes)}  ${image}\n`);
  fs.writeFileSync(path.join(source, image + '.packages.txt'), 'koya-shell 0.7.1\n');
  const prepare = (name, limit) => spawnSync('bash', [root + '/tools/prepare-release.sh', version, source, path.join(work, name)], {
    encoding: 'utf8', env: { ...process.env, KOYA_RELEASE_PART_BYTES: String(limit) }
  });
  for (const [name, limit] of [['whole', bytes.length + 1], ['boundary', bytes.length], ['split', 32]]) {
    const result = prepare(name, limit);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const release = path.join(work, name);
    const checked = spawnSync('sha256sum', ['--check', 'SHA256SUMS'], {cwd: release, encoding: 'utf8'});
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    if (name === 'split') {
      const parts = fs.readdirSync(release).filter(file => file.endsWith('.part')).sort();
      assert.equal(parts.length, Math.ceil(bytes.length / limit));
      assert(parts.every(file => fs.statSync(path.join(release, file)).size <= limit));
      assert.deepEqual(Buffer.concat(parts.map(file => fs.readFileSync(path.join(release, file)))), bytes);
      assert.match(fs.readFileSync(path.join(release, 'README.txt'), 'utf8'), /cat .*\.part/);
      assert(!fs.existsSync(path.join(release, image)));
    } else assert.deepEqual(fs.readFileSync(path.join(release, image)), bytes);
  }
  assert.notEqual(prepare('whole', 32).status, 0, 'An existing release must not be overwritten');
  assert.notEqual(prepare('oversize', 2147483648).status, 0, 'Every part must fit GitHub release limits');
  fs.appendFileSync(path.join(source, image), 'corrupt');
  assert.notEqual(prepare('corrupt', 32).status, 0, 'A corrupt image must not be released');
  assert(!fs.existsSync(path.join(work, 'corrupt')));
} finally { fs.rmSync(work, {recursive: true, force: true}); }
console.log('Release checksums, whole ISO and split ISO packaging: passed');
