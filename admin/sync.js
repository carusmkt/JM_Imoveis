/* Durable drafts and atomic publication for the static admin. */
(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function validate(properties) {
    if (!Array.isArray(properties) || properties.some(p => !p || p.id == null || !String(p.id))) {
      throw new Error('Não foi possível ler o catálogo. Nenhum imóvel foi substituído.');
    }
    if (new Set(properties.map(p => String(p.id))).size !== properties.length) {
      throw new Error('Existem códigos de imóveis repetidos. A sincronização foi interrompida para preservar os cadastros.');
    }
    return properties;
  }

  // data.js is a JSON assignment, never executable input from the network.
  function parse(text) {
    const match = text.match(/^\s*window\.imoveis\s*=\s*([\s\S]*?)\s*;?\s*$/);
    if (!match) throw new Error('O arquivo de imóveis não está no formato esperado.');
    return validate(JSON.parse(match[1]));
  }

  // Missing records are deletions only when they existed in the editor's baseline.
  // Conflicting edits stop publication; independent edits and additions survive.
  function merge(base, local, remote) {
    [base, local, remote].forEach(validate);
    const map = list => new Map(list.map(p => [String(p.id), p]));
    const b = map(base), l = map(local), r = map(remote), result = new Map();
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const before = b.get(id), ours = l.get(id), theirs = r.get(id);
      let next;
      if (equal(ours, before)) next = theirs;
      else if (equal(theirs, before) || equal(ours, theirs)) next = ours;
      else {
        throw new Error(`O imóvel ${id} foi alterado em outra sessão. Os seus dados foram preservados neste navegador; confira as duas versões antes de sincronizar.`);
      }
      if (next) result.set(id, next);
    }
    const common = base.map(p => String(p.id)).filter(id => l.has(id) && r.has(id));
    const commonIds = new Set(common);
    const order = list => list.map(p => String(p.id)).filter(id => commonIds.has(id));
    const localMoved = !equal(order(local), common), remoteMoved = !equal(order(remote), common);
    if (localMoved && remoteMoved && !equal(order(local), order(remote))) {
      throw new Error('A ordem dos imóveis foi alterada em outra sessão. Sua organização foi preservada neste navegador.');
    }
    const [primary, secondary] = remoteMoved ? [remote, local] : [local, remote];
    const ids = primary.map(p => String(p.id)).filter(id => result.has(id));
    let next = null;
    for (const { id: key } of [...secondary].reverse()) {
      const id = String(key);
      if (!result.has(id)) continue;
      if (!ids.includes(id)) {
        if (next === null) ids.push(id);
        else ids.splice(ids.indexOf(next), 0, id);
      }
      next = id;
    }
    return clone(ids.map(id => result.get(id)));
  }

  function createClient(config, fetcher = root.fetch.bind(root)) {
    const repoUrl = (owner, name) => `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let api = repoUrl(config.owner, config.repo);
    const headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
    async function request(path, method = 'GET', body) {
      const response = await fetcher(api + path, {
        method, headers, cache: 'no-store', signal: root.AbortSignal?.timeout?.(60000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        let message = response.statusText;
        try { message = (await response.json()).message || message; } catch (_) { /* Keep status text. */ }
        if (method === 'PATCH' && (response.status === 409 || /fast[- ]forward/i.test(message))) {
          message = 'O catálogo mudou durante o envio. Seus imóveis foram preservados. Clique em Tentar novamente.';
        }
        throw new Error(message || `Erro ${response.status} ao acessar o GitHub.`);
      }
      return response.json();
    }
    async function read() {
      const repo = await request('');
      const branch = repo.default_branch;
      if (!branch) throw new Error('Não foi possível identificar a versão publicada do catálogo.');
      // Follow repository transfers for writes, too: POST must use the current name.
      if (repo.owner?.login && repo.name) api = repoUrl(repo.owner.login, repo.name);
      const ref = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const head = ref.object.sha;
      const file = await request(`/contents/data.js?ref=${encodeURIComponent(head)}`);
      if (file.encoding !== 'base64' || !file.content) throw new Error('Não foi possível ler os dados atuais dos imóveis.');
      const bytes = Uint8Array.from(root.atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0));
      return { properties: parse(new TextDecoder().decode(bytes)), head, branch };
    }
    async function publish(base, local, onProgress = () => {}, onPrepared = async () => {}, prepared = null) {
      const current = await read();
      // Recover an acknowledged-on-server commit after a lost network response.
      if (prepared && equal(current.properties, prepared.properties) && equal(local, prepared.source)) {
        return clone(current.properties);
      }
      const properties = merge(base, local, current.properties);
      if (equal(properties, current.properties)) return properties;
      const tree = [];
      const total = properties.reduce((sum, p) => sum + (p.imagens || []).filter(src => src.startsWith('data:')).length, 0);
      const batch = total ? root.crypto.randomUUID() : '';
      let done = 0;
      for (const property of properties) {
        let hasNewPhoto = false;
        for (let i = 0; i < (property.imagens || []).length; i++) {
          const src = property.imagens[i];
          if (!src.startsWith('data:')) continue;
          const match = src.match(/^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,([\s\S]+)$/);
          if (!match) throw new Error(`Uma foto de ${property.nome} está em um formato inválido.`);
          onProgress(`Enviando foto ${++done}/${total}...`);
          const blob = await request('/git/blobs', 'POST', { content: match[2], encoding: 'base64' });
          const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
          const path = `images/${batch}-${tree.length}.${extension}`;
          tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
          property.imagens[i] = path;
          hasNewPhoto = true;
        }
        if (hasNewPhoto) property.imagem = property.imagens[0] || '';
      }
      onProgress('Salvando dados...');
      tree.push({ path: 'data.js', mode: '100644', type: 'blob', content: 'window.imoveis = ' + JSON.stringify(properties, null, 2) + ';' });
      // Photos and catalog become visible together, preserving every unrelated file.
      const parent = await request(`/git/commits/${current.head}`);
      const nextTree = await request('/git/trees', 'POST', { base_tree: parent.tree.sha, tree });
      const commit = await request('/git/commits', 'POST', {
        message: 'Atualizando imóveis pelo Admin', tree: nextTree.sha, parents: [current.head]
      });
      await onPrepared(clone(properties));
      await request(`/git/refs/heads/${encodeURIComponent(current.branch)}`, 'PATCH', { sha: commit.sha, force: false });
      return properties;
    }
    return { read, publish };
  }

  // IndexedDB holds photos too, without localStorage's small size limit.
  function createDraftStore(env = root) {
    let database;
    const prefix = 'jm-admin-draft:';
    const conflict = () => Object.assign(new Error('Outra aba guardou alterações neste navegador. Mantenha esta aba aberta e sincronize para preservar também as suas alterações.'), { code: 'DRAFT_CONFLICT' });
    const conflicts = (current, expected) => current?.dirty && (current.version ?? current.updatedAt) !== expected;
    function readFallback(key) {
      try { return JSON.parse(env.localStorage.getItem(prefix + key) || 'null'); } catch (_) { return null; }
    }
    function open() {
      if (!database) database = new Promise((resolve, reject) => {
        const req = env.indexedDB.open('jm-admin', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('drafts');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('O armazenamento local está bloqueado.'));
      });
      return database;
    }
    async function transaction(key, value, writing, expected) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('drafts', writing ? 'readwrite' : 'readonly');
        const drafts = tx.objectStore('drafts');
        const req = drafts.get(key);
        let blocked = false;
        if (writing) req.onsuccess = () => {
          const fallback = readFallback(key);
          const current = !req.result || (fallback && fallback.updatedAt > req.result.updatedAt) ? fallback : req.result;
          blocked = conflicts(current, expected);
          if (!blocked) drafts.put(value, key);
        };
        tx.oncomplete = () => resolve(writing ? !blocked : req.result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Não foi possível salvar o rascunho.'));
      });
    }
    return {
      async load(key) {
        let saved;
        try { saved = await transaction(key); } catch (_) { /* Try localStorage. */ }
        const fallback = readFallback(key);
        return !saved || (fallback && fallback.updatedAt > saved.updatedAt) ? fallback : saved;
      },
      async save(key, value, expected) {
        let written;
        try { written = await transaction(key, value, true, expected); }
        catch (_) {
          if (conflicts(readFallback(key), expected)) throw conflict();
          env.localStorage.setItem(prefix + key, JSON.stringify(value));
          return;
        }
        if (!written) throw conflict();
      }
    };
  }

  const api = { clone, validate, parse, merge, createClient, createDraftStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdminSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
