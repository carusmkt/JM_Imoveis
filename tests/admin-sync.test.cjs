const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const sync = require('../admin/sync.js');

const photo = 'data:image/jpeg;base64,aW1hZ2U=';
const property = (id, extra = {}) => ({ id, nome: `Imóvel ${id}`, imagens: ['images/existing.jpg'], ...extra });
const ids = properties => properties.map(p => p.id);

test('data.js parses accents and semicolons without executing code', () => {
  assert.deepEqual(sync.parse('window.imoveis = [{"id":"0001","nome":"Ação; casa"}];'), [{ id: '0001', nome: 'Ação; casa' }]);
  assert.deepEqual(sync.parse(' window.imoveis = [] \n'), []);
  assert.throws(() => sync.parse('window.imoveis = []; alert("bad")'));
  assert.throws(() => sync.parse('window.imoveis = [{"id":"1"},{"id":"1"}];'));
  assert.throws(() => sync.parse('window.imoveis = null;'));
});

test('a stale catalog cannot remove remote additions or undo independent changes', () => {
  const base = [property('0001'), property('0002')];
  const local = [property('0001', { nome: 'Edição local' }), base[1], property('0003')];
  const remote = [base[0], property('0002', { arquivado: true }), property('0004')];
  const result = sync.merge(base, local, remote);
  assert.deepEqual(ids(result), ['0001', '0002', '0003', '0004']);
  assert.equal(result[0].nome, 'Edição local');
  assert.equal(result[1].arquivado, true);
  assert.equal(base[0].nome, 'Imóvel 0001');
});

test('unchanged remote records deleted locally stay deleted; remote deletions are respected', () => {
  const base = [property('0001'), property('0002'), property('0003')];
  assert.deepEqual(ids(sync.merge(base, [base[1], base[2]], [base[0], base[1], property('0004')])), ['0002', '0004']);
});

test('concurrent edits, delete/edit races and reused new IDs cannot silently overwrite records', () => {
  const base = [property('0001')];
  const local = [property('0001', { nome: 'Nossa versão' })];
  const remote = [property('0001', { nome: 'Outra versão' })];
  assert.throws(() => sync.merge(base, local, remote), /0001/);
  assert.throws(() => sync.merge(base, [], remote), /0001/);
  assert.throws(() => sync.merge(base, local, []), /0001/);
  assert.throws(() => sync.merge([], local, remote), /0001/);
});

test('local order, remote order, insertion positions, archived and trashed records survive merging', () => {
  const a = property('a'), b = property('b'), c = property('c');
  const archive = property('archive', { arquivado: true });
  const trash = property('trash', { lixeira: true });
  const base = [a, b, c, archive, trash];
  assert.deepEqual(ids(sync.merge(base, [c, a, b, archive, trash], base)), ['c', 'a', 'b', 'archive', 'trash']);
  assert.deepEqual(ids(sync.merge(base, base, [b, a, c, archive, trash])), ['b', 'a', 'c', 'archive', 'trash']);
  assert.deepEqual(ids(sync.merge(base, [a, property('copy'), b, c, archive, trash], base)), ['a', 'copy', 'b', 'c', 'archive', 'trash']);
  assert.deepEqual(ids(sync.merge(base, [a, b, c, { ...archive, nome: 'Novo nome' }, trash], [a, property('remote-copy'), b, c, archive, trash])), ['a', 'remote-copy', 'b', 'c', 'archive', 'trash']);
  assert.throws(() => sync.merge(base, [c, a, b, archive, trash], [b, a, c, archive, trash]), /ordem/);
});

// A fake Git server records branch visibility separately from unreferenced blobs.
function github(remote, { failAt, beforePatch, loseResponse = false, transferred = false } = {}) {
  const calls = [];
  let visible = sync.clone(remote), staged, tree;
  const fetcher = async (url, options) => {
    const repoPath = transferred && calls.length ? 'new-owner/repo' : 'owner/repo';
    const route = url.replace(`https://api.github.com/repos/${repoPath}`, '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ route, method: options.method, body });
    const ok = data => ({ ok: true, json: async () => data });
    if (route === failAt) return { ok: false, status: 503, json: async () => ({ message: 'Falha simulada' }) };
    if (route === '') return ok({ default_branch: 'main', name: 'repo', owner: { login: transferred ? 'new-owner' : 'owner' } });
    if (route === '/git/ref/heads/main') return ok({ object: { sha: 'head' } });
    if (route === '/git/commits/head') return ok({ tree: { sha: 'old-tree' } });
    if (route === '/contents/data.js?ref=head') return ok({ encoding: 'base64', content: Buffer.from('window.imoveis = ' + JSON.stringify(visible) + ';').toString('base64') });
    if (route === '/git/blobs') return ok({ sha: `blob-${calls.length}` });
    if (route === '/git/trees') {
      tree = body;
      staged = sync.parse(body.tree.find(entry => entry.path === 'data.js').content);
      return ok({ sha: 'new-tree' });
    }
    if (route === '/git/commits') return ok({ sha: 'new-commit' });
    if (route === '/git/refs/heads/main') {
      if (beforePatch) return beforePatch(body);
      visible = staged;
      if (loseResponse) throw new TypeError('Failed to fetch');
      return ok({ object: { sha: 'new-commit' } });
    }
    throw new Error(`Unexpected request ${route}`);
  };
  return { fetcher, calls, visible: () => visible, tree: () => tree };
}
const client = server => sync.createClient({ owner: 'owner', repo: 'repo', token: 'test-token' }, server.fetcher);

test('photos and data become visible in one commit, retaining every unrelated file', async () => {
  const base = [property('0001')];
  const local = [...base, property('0002', { nome: 'Balneário Camboriú', imagens: [photo, photo], fotosComodos: ['Sala', 'Quarto'] })];
  const server = github(base);
  let prepared;
  const result = await client(server).publish(base, local, () => {}, async properties => {
    prepared = properties;
    assert.deepEqual(server.visible(), base, 'the branch must still contain the original complete catalog');
  });
  assert.deepEqual(server.visible(), result);
  assert.deepEqual(prepared, result);
  assert.equal(server.tree().base_tree, 'old-tree');
  assert.equal(server.tree().tree.length, 3);
  assert.deepEqual(result[1].fotosComodos, ['Sala', 'Quarto']);
  assert.match(result[1].imagens[0], /^images\/.+\.jpg$/);
  assert.equal(result[1].imagem, result[1].imagens[0]);
  assert.equal(local[1].imagens[0], photo, 'original draft photos are never mutated');
  assert.deepEqual(server.calls.at(-1).body, { sha: 'new-commit', force: false });
  assert(server.calls.every(c => c.method !== 'PUT'), 'individual photo uploads must not deploy stale data.js');
});

for (const failAt of ['/git/blobs', '/git/trees', '/git/commits', '/git/refs/heads/main']) {
  test(`failure at ${failAt} keeps the full live list, original photos and old published catalog`, async () => {
    const base = [property('0001')];
    const local = [...base, property('0002', { imagens: [photo] })];
    const before = sync.clone(local);
    const server = github(base, { failAt });
    await assert.rejects(client(server).publish(base, local), /Falha/);
    assert.deepEqual(local, before);
    assert.deepEqual(server.visible(), base);
  });
}

test('a concurrent branch update rejects publication without forcing or losing the draft', async () => {
  const base = [property('0001')];
  const local = [...base, property('0002', { imagens: [photo] })];
  const server = github(base, { beforePatch: async body => {
    assert.equal(body.force, false);
    return { ok: false, status: 422, json: async () => ({ message: 'Update is not a fast forward' }) };
  } });
  await assert.rejects(client(server).publish(base, local), /Tentar novamente/);
  assert.equal(local[1].imagens[0], photo);
  assert.deepEqual(server.visible(), base);
});

test('retry after a lost success response acknowledges the saved publication without duplicating photos', async () => {
  const base = [property('0001')], local = [...base, property('0002', { imagens: [photo] })];
  const server = github(base, { loseResponse: true });
  let prepared;
  await assert.rejects(client(server).publish(base, local, () => {}, async properties => {
    prepared = { properties, source: sync.clone(local) };
  }));
  const writes = server.calls.filter(c => c.method === 'POST').length;
  assert.deepEqual(await client(server).publish(base, local, () => {}, async () => {}, prepared), server.visible());
  assert.equal(server.calls.filter(c => c.method === 'POST').length, writes);
  const changed = sync.clone(local);
  changed[1].nome = 'Nova edição após a falha';
  await assert.rejects(client(server).publish(base, changed, () => {}, async () => {}, prepared), /outra sessão/);
});

test('unreadable remote catalog cannot be replaced with an empty or outdated local file', async () => {
  const server = github([], { failAt: '/contents/data.js?ref=head' });
  await assert.rejects(client(server).publish([], [property('0001')]), /Falha/);
  assert(server.calls.every(c => c.method === 'GET'));
});

test('a second sync from a stale tab with no edits cannot remove the just published property', async () => {
  const old = [property('0001')], current = [...old, property('0021')];
  const server = github(current);
  assert.deepEqual(await client(server).publish(old, old), current);
  assert.deepEqual(server.visible(), current);
  assert(server.calls.every(c => c.method === 'GET'));
});

test('after a repository transfer, all publication requests use the current owner', async () => {
  const server = github([], { transferred: true });
  const local = [property('0001', { imagens: [photo] })];
  await client(server).publish([], local);
  assert.deepEqual(ids(server.visible()), ['0001']);
});

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
test('drafts including new photos survive reloading when IndexedDB is unavailable', async () => {
  const env = { localStorage: memoryStorage() };
  const draft = { base: [property('0001')], properties: [property('0001'), property('0002', { imagens: [photo] })], dirty: true, updatedAt: 1 };
  await sync.createDraftStore(env).save('owner/repo', draft);
  assert.deepEqual(await sync.createDraftStore(env).load('owner/repo'), draft);
  assert.equal(await sync.createDraftStore(env).load('other/repo'), null);
});

test('a stale tab cannot replace another tab’s pending draft in the browser', async () => {
  const env = { localStorage: memoryStorage() };
  const first = sync.createDraftStore(env), second = sync.createDraftStore(env);
  const draft = { properties: [property('0021', { imagens: [photo] })], dirty: true, version: 'first:1' };
  await first.save('owner/repo', draft);
  await assert.rejects(second.save('owner/repo', { properties: [], dirty: false }), { code: 'DRAFT_CONFLICT' });
  await assert.rejects(second.save('owner/repo', { properties: [property('0002')], dirty: true }), { code: 'DRAFT_CONFLICT' });
  assert.deepEqual(await first.load('owner/repo'), draft);
  await first.save('owner/repo', { ...draft, dirty: false }, 'first:1');
  assert.equal((await second.load('owner/repo')).dirty, false);
});
test('storage failures are reported instead of pretending the photos were saved', async () => {
  const store = sync.createDraftStore({ localStorage: { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Quota exceeded'); } } });
  assert.equal(await store.load('owner/repo'), null);
  await assert.rejects(store.save('owner/repo', { properties: [] }), /Quota/);
});

const html = readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
const mainScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('let imoveisData'));
async function mount({ published = [], draft, remote, publish, storageFailure = false } = {}) {
  const page = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = page.window;
  await new Promise(resolve => win.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  win.imoveis = sync.clone(published);
  win.console.error = () => {};
  let saved = draft, publishCount = 0;
  const store = {
    load: async () => saved,
    save: async (key, value) => {
      if (storageFailure) throw Error('Quota exceeded');
      saved = sync.clone(value);
    }
  };
  win.AdminCore = require('../admin/core.js');
  win.AdminSync = { ...sync, createDraftStore: () => store, createClient: () => ({
    read: async () => {
      if (!remote) throw Error('Offline');
      return { properties: remote };
    },
    publish: async (...args) => { publishCount++; return publish(...args); }
  }) };
  if (remote || publish) {
    for (const [key, value] of Object.entries({ gh_owner: 'owner', gh_repo: 'repo', gh_token: 'test' })) win.localStorage.setItem(key, value);
  }
  vm.runInContext(readFileSync(path.join(__dirname, '../admin/board.js'), 'utf8'), page.getInternalVMContext());
  vm.runInContext(mainScript, page.getInternalVMContext());
  await win.initializeAdminData();
  await win.eval('draftWrites').catch(() => {});
  return { page, win, saved: () => saved, calls: () => publishCount, state: () => win.eval('syncState'), properties: () => JSON.parse(win.eval('JSON.stringify(imoveisData)')) };
}

test('startup restores an unsynced property and its original photos into the actual admin list', async t => {
  const base = [property('0001')];
  const draft = { base, properties: [...base, property('0002', { imagens: [photo] })], dirty: true };
  const ui = await mount({ published: base, draft });
  t.after(() => ui.page.window.close());
  assert.deepEqual(ui.properties(), draft.properties);
  assert.equal(ui.win.document.querySelectorAll('.property-card').length, 2);
  assert.equal(ui.state(), 'pending');
  assert.equal(ui.win.document.getElementById('btn-sync').disabled, false);
});

test('Salvar stores the new property and its photo before any GitHub request, so reload recovers both', async t => {
  const base = [property('0001')];
  const ui = await mount({ published: base });
  t.after(() => ui.page.window.close());
  ui.win.document.getElementById('property-dialog').close = () => {};
  ui.win.document.getElementById('f-nome').value = 'Boreal Tower';
  ui.win.eval(`currentImages = [${JSON.stringify(photo)}]; currentImageTags = ['Sala'];`);
  ui.win.saveProperty();
  await ui.win.eval('draftWrites');
  assert.equal(ui.calls(), 0);
  const reloaded = await mount({ published: base, draft: ui.saved() });
  t.after(() => reloaded.page.window.close());
  assert.equal(reloaded.properties()[1].nome, 'Boreal Tower');
  assert.deepEqual(reloaded.properties()[1].imagens, [photo]);
  assert.equal(reloaded.state(), 'pending');
});

test('reload uses the repository or last successful snapshot while the site still serves stale data.js', async t => {
  const old = [property('0001')], latest = [...old, property('0002')];
  const draft = { base: latest, properties: latest, dirty: false };
  for (const remote of [undefined, latest]) {
    const ui = await mount({ published: old, draft, remote });
    t.after(() => ui.page.window.close());
    assert.deepEqual(ui.properties(), latest);
    assert.equal(ui.win.document.querySelectorAll('.property-card').length, 2);
    assert.equal(ui.state(), 'synced');
  }
});

test('during a failed sync cards remain visible; duplicate clicks are ignored and retry retains every property', async t => {
  const base = [property('0001')], local = [...base, property('0002', { imagens: [photo] })];
  let rejectUpload;
  const ui = await mount({ published: base, draft: { base, properties: local, dirty: true }, publish: () => new Promise((resolve, reject) => { rejectUpload = reject; }) });
  t.after(() => ui.page.window.close());
  const sending = ui.win.saveToGithub();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.win.document.querySelectorAll('.property-card').length, 2);
  assert.equal(ui.win.document.getElementById('list-panel').inert, true);
  await ui.win.saveToGithub();
  assert.equal(ui.calls(), 1);
  rejectUpload(Error('Offline'));
  await sending;
  assert.deepEqual(ui.properties(), local);
  assert.deepEqual(ui.saved().properties, local);
  assert.equal(ui.state(), 'error');
  assert.equal(ui.win.document.getElementById('list-panel').inert, false);
  assert.equal(ui.win.document.querySelectorAll('.property-card').length, 2);
});

test('a later edit during an async send is kept pending instead of marked as synced or overwritten', async t => {
  const base = [property('0001')];
  let finish;
  const ui = await mount({ published: base, publish: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => ui.page.window.close());
  const sending = ui.win.saveToGithub();
  await new Promise(resolve => setImmediate(resolve));
  ui.win.eval('imoveisData.push({ id: "0002", nome: "Novo", imagens: [] }); markDirty();');
  finish(base);
  await sending;
  assert.deepEqual(ids(ui.properties()), ['0001', '0002']);
  assert.equal(ui.state(), 'pending');
  assert.equal(ui.saved().dirty, true);
});

test('a missing data.js and unavailable repository cannot enable destructive empty sync', async t => {
  const ui = await mount({ published: null });
  t.after(() => ui.page.window.close());
  assert.equal(ui.state(), 'error');
  assert.equal(ui.win.document.getElementById('btn-sync').disabled, true);
  assert.equal(ui.win.document.getElementById('list-panel').inert, true);
  assert.equal(ui.win.document.getElementById('config-panel').inert, false);
});

test('successful publication keeps every card and saves a clean snapshot with published photo links', async t => {
  const base = [property('0001')], local = [...base, property('0002', { imagens: [photo] })];
  const published = sync.clone(local);
  published[1].imagens = ['images/published.jpg'];
  published[1].imagem = 'images/published.jpg';
  const ui = await mount({ published: base, draft: { base, properties: local, dirty: true }, publish: async (before, snapshot, progress, prepared) => {
    assert.deepEqual(before, base);
    assert.deepEqual(snapshot, local);
    await prepared(published);
    return published;
  } });
  t.after(() => ui.page.window.close());
  await ui.win.saveToGithub();
  assert.deepEqual(ui.properties(), published);
  assert.equal(ui.state(), 'synced');
  assert.equal(ui.saved().dirty, false);
  assert.equal(ui.saved().prepared, null);
  assert.deepEqual(ui.saved().base, published);
  assert.equal(ui.win.document.querySelectorAll('.property-card').length, 2);
});

test('reloading after a lost response recognizes the published commit but never discards a subsequent edit', async t => {
  const base = [property('0001')], source = [...base, property('0002', { imagens: [photo] })];
  const remote = sync.clone(source);
  remote[1].imagens = ['images/published.jpg'];
  const prepared = { properties: remote, source };
  const confirmed = await mount({ published: base, remote, draft: { base, properties: source, dirty: true, prepared } });
  t.after(() => confirmed.page.window.close());
  assert.deepEqual(confirmed.properties(), remote);
  assert.equal(confirmed.state(), 'synced');
  const edited = sync.clone(source);
  edited[1].nome = 'Uma edição posterior';
  const pending = await mount({ published: base, remote, draft: { base, properties: edited, dirty: true, prepared } });
  t.after(() => pending.page.window.close());
  assert.deepEqual(pending.properties(), edited);
  assert.equal(pending.state(), 'pending');
});

test('a browser storage quota failure still allows publishing and does not remove cards', async t => {
  const properties = [property('0001')];
  const ui = await mount({ published: properties, storageFailure: true, publish: async () => properties });
  t.after(() => ui.page.window.close());
  await ui.win.saveToGithub();
  assert.equal(ui.calls(), 1);
  assert.deepEqual(ui.properties(), properties);
  assert.equal(ui.state(), 'synced');
});
