// Publish the built static tree without touching the source branch or worktree.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyArtifact,gitSource} from './lib/release-artifact.mjs';
import {verifyReleaseGates} from './lib/release-gates.mjs';
const source = process.cwd();
const candidateDist = path.resolve('dist');
if (!existsSync(path.join(candidateDist, 'index.html'))) throw new Error('Run node scripts/build.mjs first.');
const run = (args, options = {}) => {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8', ...options });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Git command failed.');
    return result.stdout.trim();
};
const remote = run(['remote', 'get-url', 'origin']);
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(remote)) throw new Error('origin must be the intended GitHub HTTPS repository.');
const current=gitSource();
if(current.dirty)throw new Error('工作區尚有未提交修改；公開發布前請提交並重新建置。');
const artifact=await verifyArtifact(candidateDist,{publicOnly:true,expectedCommit:current.commit,requireClean:true});
if(artifact.release.source.tree!==current.tree)throw new Error('建置的來源 tree 不符，已停止發布。');
// Never accept a caller-supplied "passed" file: resolve authoritative workflow
// status, artifact digest and executed-source scope from GitHub on every publish.
const gates=await verifyReleaseGates({directory:candidateDist});
// Promote the fresh, byte-identical isolated snapshot. Another process rebuilding
// dist during network verification cannot change the tree about to be pushed.
const dist=gates.preparedDirectory;
console.log(JSON.stringify({releaseGates:gates.gates.map(g=>({kind:g.kind,runId:g.runId,reused:g.reused}))}));
const directory = mkdtempSync(path.join(os.tmpdir(), 'model-lens-pages-'));
try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, 'index') };
    const gitDirectory = run(['rev-parse', '--absolute-git-dir']);
    const prefix = [`--git-dir=${gitDirectory}`, `--work-tree=${dist}`];
    run([...prefix, 'read-tree', '--empty'], { env, cwd: dist });
    run([...prefix, 'add', '--all', '--', '.', ':(exclude).openai'], { env, cwd: dist });
    const tree = run([...prefix, 'write-tree'], { env, cwd: dist });
    const remoteHead = run(['ls-remote', '--heads', 'origin', 'refs/heads/gh-pages']).split(/\s+/)[0];
    if (remoteHead) run(['fetch', '--no-tags', 'origin', 'gh-pages']);
    const parents = remoteHead ? ['-p', remoteHead] : [];
    const commit = run(['-c', 'user.name=GH Studio', '-c', 'user.email=sites@users.noreply.openai.com', 'commit-tree', tree, ...parents, '-m', 'Deploy Model Lens to GitHub Pages']);
    // A normal push rejects concurrent non-fast-forward updates; no force push.
    run(['push', 'origin', `${commit}:refs/heads/gh-pages`]);
    console.log(JSON.stringify({ branch: 'gh-pages', commit, repository: remote }));
} finally {
    // This exact directory was created above and is confined to the OS temp root.
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (directory.startsWith(tempRoot) && path.basename(directory).startsWith('model-lens-pages-')) rmSync(directory, { recursive: true, force: true });
}
