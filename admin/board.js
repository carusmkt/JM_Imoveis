/* The admin remains a static site. Only the PIN animation needs a React island. */
(function () {
  const selected = new Set();
  let sortables = [];
  let organizing = false;
  let previousOrder = null;
  let lightbox = { images: [], tags: [], index: 0, name: '' };
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<iconify-icon icon="lucide:${name}" aria-hidden="true"></iconify-icon>`;
  const published = () => imoveisData.filter(isAtivo);
  const query = () => ($('property-search').value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matches = property => [property.nome, property.id, property.localizacao, property.tipo, property.cidade, property.bairro].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query());
  const photos = property => property.imagens?.length ? property.imagens : property.imagem ? [property.imagem] : [];
  function imageUrl(src) {
    // Property photos are ignored by git. Local preview reads the existing public originals.
    if (['localhost', '127.0.0.1'].includes(location.hostname) && /^images\//.test(src || '')) {
      return 'https://www.judsonmartins.com.br/' + src;
    }
    return /^(https?:|data:image\/|blob:)/.test(src || '') || /^(images|img)\//.test(src || '') ? src : '';
  }
  function announce(message) {
    $('board-announcement').textContent = message;
  }
  function action(name, label, id, symbol, extra = '') {
    return `<button type="button" class="card-action ${extra}" data-action="${name}" data-id="${escape(id)}" aria-label="${escape(label)}" title="${escape(label)}">${icon(symbol)}</button>`;
  }
  function card(property, index, featured) {
    const id = escape(property.id);
    const name = escape(property.nome || 'Imóvel sem nome');
    const images = photos(property);
    const state = isArquivado(property) ? 'Arquivado' : isNaLixeira(property) ? 'Na lixeira' : featured ? 'Em destaque' : (property.finalidade === 'Aluguel' ? 'Aluguel' : 'Venda');
    const el = document.createElement('article');
    el.className = 'property-card' + (selected.has(property.id) ? ' is-selected' : '');
    el.dataset.id = property.id;
    let actions = '';
    if (listView === 'lixeira') {
      actions = action('restore', 'Restaurar imóvel', property.id, 'rotate-ccw') + action('destroy', 'Apagar definitivamente', property.id, 'trash-2', 'danger');
    } else {
      actions = action('duplicate', 'Duplicar imóvel', property.id, 'copy') + action(listView === 'arquivados' ? 'publish' : 'archive', listView === 'arquivados' ? 'Publicar imóvel' : 'Arquivar imóvel', property.id, listView === 'arquivados' ? 'archive-restore' : 'archive') + action('delete', 'Mover para a lixeira', property.id, 'trash-2', 'danger');
    }
    el.innerHTML = `
      <div class="property-card-media">
        <button type="button" class="property-photo" data-action="preview" data-id="${id}" aria-label="Ver fotos de ${name}">
          ${images.length ? `<img src="${escape(imageUrl(images[0]))}" alt="${name}" loading="lazy" decoding="async">` : ''}
          <span class="photo-fallback">${icon('image')}<span>Foto indisponível</span></span>
          <span class="photo-expand">${icon('expand')} Ver foto inteira</span>
        </button>
        <span class="property-state${featured ? ' featured' : ''}">${featured ? icon('star') : ''}${state}</span>
        ${listView === 'ativos' ? `<label class="card-select" title="Selecionar ${name}"><input type="checkbox" data-select="${id}" aria-label="Selecionar ${name}" ${selected.has(property.id) ? 'checked' : ''}><span>${icon('check')}</span></label>` : ''}
        <span class="photo-count">${icon('images')} ${images.length}</span>
      </div>
      <div class="property-card-content">
        <div class="property-card-meta"><span>${escape(property.tipo || 'Imóvel')}</span><span>Cód. ${escape(formatId(property.id))}</span></div>
        <h3><button type="button" data-action="edit" data-id="${id}">${name}</button></h3>
        <p class="property-location">${icon('map-pin')}${escape(property.localizacao || [property.bairro, property.cidade].filter(Boolean).join(', ') || 'Localização não informada')}</p>
        <p class="property-price">${escape(property.preco || 'Valor não informado')}</p>
        <div class="property-features">
          ${(property.areaUtil || property.areaTotal || property.area) ? `<span>${icon('ruler')}${escape(property.areaUtil || property.areaTotal || property.area)}</span>` : ''}
          ${Number(property.quartos) > 0 ? `<span>${icon('bed-double')}${escape(property.quartos)} quartos</span>` : ''}
          ${Number(property.vagas) > 0 ? `<span>${icon('car-front')}${escape(property.vagas)} vagas</span>` : ''}
        </div>
        ${listView === 'lixeira' ? `<p class="trash-expiry">Exclusão em ${diasRestantesLixeira(property)} dias</p>` : ''}
      </div>
      <div class="property-card-footer">
        ${listView === 'ativos' ? `<button type="button" class="drag-handle" aria-label="Arrastar ${name} para reorganizar" title="Arraste para reorganizar">${icon('grip-vertical')}<span>${index + 1}</span></button>` : ''}
        ${listView !== 'lixeira' ? `<button type="button" class="card-edit" data-action="edit" data-id="${id}">${icon('pencil')} Editar</button>` : ''}
        <div class="card-secondary-actions">${actions}</div>
      </div>`;
    const image = el.querySelector('img');
    if (image) image.addEventListener('error', () => { image.hidden = true; el.querySelector('.property-photo').classList.add('image-failed'); }, { once: true });
    return el;
  }

  function section(title, description, properties, featured, all) {
    const section = document.createElement('section');
    section.className = featured ? 'property-section featured-tray' : 'property-section';
    section.innerHTML = `<div class="property-section-heading"><div><h3>${featured ? icon('star') : ''}${title}<span class="section-count">${properties.length}${featured ? '/6' : ''}</span></h3><p>${description}</p></div></div><div class="property-grid" data-grid="${featured ? 'featured' : 'catalog'}"></div>`;
    const grid = section.querySelector('.property-grid');
    const visible = properties.filter(matches);
    for (const property of visible) grid.appendChild(card(property, all.indexOf(property), featured));
    if (!visible.length) grid.innerHTML = `<p class="board-empty">${query() ? 'Nenhum imóvel nesta seção corresponde à busca.' : featured ? 'Os seis primeiros imóveis publicados aparecem aqui.' : 'Todos os imóveis publicados estão em destaque.'}</p>`;
    return section;
  }

  function render() {
    sortables.forEach(sortable => sortable.destroy());
    sortables = [];
    updateListCounts();
    const list = getViewList();
    for (const id of selected) if (!list.some(p => p.id === id) || listView !== 'ativos') selected.delete(id);
    const container = $('imoveis-list');
    container.replaceChildren();
    $('board-selection-tools').hidden = listView !== 'ativos';
    $('btn-organize').hidden = listView !== 'ativos';
    $('btn-organize').setAttribute('aria-pressed', String(organizing));
    $('btn-organize').innerHTML = icon(organizing ? 'check' : 'grip') + (organizing ? 'Concluir organização' : 'Reorganizar');
    $('organize-help').hidden = !organizing || listView !== 'ativos';
    $('undo-order').hidden = !previousOrder || listView !== 'ativos';
    if (listView === 'ativos') {
      const featured = AdminCore.featured(imoveisData);
      container.appendChild(section('Em destaque', 'Os seis primeiros imóveis aparecem na página inicial, nesta ordem.', featured, true, list));
      container.appendChild(section('Todos os outros imóveis', 'Continue organizando o catálogo. Mova um imóvel para o início para destacá-lo.', list.filter(p => !featured.includes(p)), false, list));
    } else {
      if (listView === 'lixeira') {
        const warning = document.createElement('p');
        warning.className = 'lixeira-aviso';
        warning.textContent = 'Os imóveis são apagados definitivamente 30 dias após a exclusão. Você pode restaurá-los antes disso.';
        container.appendChild(warning);
      }
      const grid = document.createElement('div');
      grid.className = 'property-grid';
      list.filter(matches).forEach((p, index) => grid.appendChild(card(p, index, false)));
      if (!grid.children.length) grid.innerHTML = '<p class="board-empty">Nenhum imóvel por aqui.</p>';
      container.appendChild(grid);
    }
    container.classList.toggle('is-organizing', organizing);
    setupDrag();
    updateSelection();
  }

  function updateSelection() {
    document.querySelectorAll('.property-card').forEach(card => {
      const checked = selected.has(card.dataset.id);
      card.classList.toggle('is-selected', checked);
      const input = card.querySelector('[data-select]');
      if (input) input.checked = checked;
    });
    const visible = getViewList().filter(matches);
    $('select-all-properties').checked = visible.length > 0 && visible.every(p => selected.has(p.id));
    $('select-all-properties').indeterminate = visible.some(p => selected.has(p.id)) && !$('select-all-properties').checked;
    $('selection-bar').hidden = !selected.size || listView !== 'ativos';
    $('selection-count').textContent = `${selected.size} ${selected.size === 1 ? 'selecionado' : 'selecionados'}`;
    const selectedInOrder = published().filter(p => selected.has(p.id));
    $('move-position').textContent = `Mover ${selected.size === 1 ? 'imóvel' : selected.size + ' imóveis'}`;
    $('move-position-input').max = Math.max(1, published().length - selectedInOrder.length + 1);
  }

  function commit(next, message) {
    if (next.every((p, i) => p === imoveisData[i])) return;
    previousOrder = imoveisData.map(p => p.id);
    imoveisData = next;
    markDirty();
    render();
    announce(message + ' Sincronize para atualizar o site.');
  }

  function moveSelection(destination) {
    if (!selected.size) return;
    const active = published();
    const indices = active.map((p, i) => selected.has(p.id) ? i : -1).filter(i => i >= 0);
    const rest = active.filter(p => !selected.has(p.id));
    let position = 0;
    if (destination === 'last') position = rest.length;
    if (destination === 'up') position = Math.max(0, indices[0] - 1);
    if (destination === 'down') position = Math.min(rest.length, indices[indices.length - 1] - indices.length + 2);
    if (typeof destination === 'number') position = destination;
    commit(AdminCore.move(imoveisData, selected, position), `${selected.size} imóvel(is) reposicionado(s).`);
  }

  function setupDrag() {
    if (listView !== 'ativos' || query() || typeof Sortable === 'undefined') return;
    let moving = [];
    document.querySelectorAll('[data-grid]').forEach(grid => {
      sortables.push(new Sortable(grid, {
        group: 'published-properties', draggable: '.property-card', handle: '.drag-handle',
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
        ghostClass: 'board-drag-ghost', chosenClass: 'board-drag-chosen',
        delay: 80, delayOnTouchOnly: true, touchStartThreshold: 5,
        onStart(event) {
          moving = selected.has(event.item.dataset.id) ? [...selected] : [event.item.dataset.id];
          event.item.dataset.movingCount = moving.length;
          announce(`Movendo ${moving.length} imóvel(is).`);
        },
        onEnd(event) {
          const cards = [...document.querySelectorAll('[data-grid] .property-card')];
          const after = cards.slice(cards.indexOf(event.item) + 1).find(card => !moving.includes(card.dataset.id));
          const rest = published().filter(p => !moving.includes(p.id));
          const position = after ? rest.findIndex(p => p.id === after.dataset.id) : rest.length;
          const next = AdminCore.move(imoveisData, moving, position);
          // Render even on a no-op drop to restore the six-slot tray boundary.
          commit(next, `${moving.length} imóvel(is) reposicionado(s).`);
          render();
        }
      }));
    });
  }

  function preview(images, tags, index, name) {
    if (!images.length) { announce('Este imóvel ainda não tem fotos.'); return; }
    lightbox = { images: [...images], tags: [...tags], index, name };
    updatePhoto();
    $('photo-dialog').showModal();
  }
  function updatePhoto() {
    const { images, tags, index, name } = lightbox;
    const image = $('photo-full');
    $('photo-error').hidden = true;
    image.hidden = false;
    image.src = imageUrl(images[index]);
    image.alt = `${name} · ${tags[index] || 'Foto ' + (index + 1)}`;
    $('photo-title').textContent = name;
    $('photo-caption').textContent = `${index + 1} de ${images.length}${tags[index] ? ' · ' + tags[index] : ''}`;
    $('photo-previous').disabled = index === 0;
    $('photo-next').disabled = index === images.length - 1;
  }

  function init() {
    $('imoveis-list').addEventListener('change', event => {
      const id = event.target.dataset.select;
      if (!id) return;
      event.target.checked ? selected.add(id) : selected.delete(id);
      updateSelection();
    });
    $('imoveis-list').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const { action: name, id } = button.dataset;
      if (name === 'preview') {
        const property = imoveisData.find(p => p.id === id);
        preview(photos(property), property.fotosComodos || [], 0, property.nome);
      } else {
        ({ edit: openForm, duplicate: duplicateProperty, archive: archiveProperty, publish: unarchiveProperty, delete: deleteProperty, restore: restoreProperty, destroy: destroyProperty })[name]?.(id);
      }
    });
    $('select-all-properties').addEventListener('change', event => {
      getViewList().filter(matches).forEach(p => event.target.checked ? selected.add(p.id) : selected.delete(p.id));
      updateSelection();
    });
    $('property-search').addEventListener('input', render);
    $('clear-selection').addEventListener('click', () => { selected.clear(); updateSelection(); });
    document.querySelectorAll('[data-move-selection]').forEach(button => button.addEventListener('click', () => moveSelection(button.dataset.moveSelection)));
    $('move-position').addEventListener('click', () => {
      $('move-position-hint').textContent = `O grupo mantém sua ordem. Escolha uma posição entre 1 e ${$('move-position-input').max}. As primeiras seis vagas são os destaques.`;
      $('move-position-input').value = '1';
      $('move-dialog').showModal();
    });
    $('move-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!$('move-form').reportValidity()) return;
      moveSelection(Number($('move-position-input').value) - 1);
      $('move-dialog').close();
    });
    $('undo-order').addEventListener('click', () => {
      if (!previousOrder) return;
      const existing = new Map(imoveisData.map(p => [p.id, p]));
      const restored = previousOrder.map(id => existing.get(id)).filter(Boolean);
      // Keep properties created since that move; do not restore deleted records or states.
      imoveisData = restored.concat(imoveisData.filter(p => !previousOrder.includes(p.id)));
      previousOrder = null;
      markDirty(); render(); announce('Última reorganização desfeita. Sincronize para atualizar o site.');
    });
    $('photo-close').addEventListener('click', () => $('photo-dialog').close());
    $('photo-dialog').addEventListener('click', event => { if (event.target === $('photo-dialog')) $('photo-dialog').close(); });
    const step = direction => {
      const next = lightbox.index + direction;
      if (next < 0 || next >= lightbox.images.length) return;
      lightbox.index = next; updatePhoto();
    };
    $('photo-previous').addEventListener('click', () => step(-1));
    $('photo-next').addEventListener('click', () => step(1));
    $('photo-dialog').addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    });
    $('photo-full').addEventListener('error', () => { $('photo-full').hidden = true; $('photo-error').hidden = false; });
    // Any editor field can affect quality; optional video and detailed prices included.
    $('property-dialog').addEventListener('input', recalcQualidade);
    document.querySelectorAll('.form-group > label').forEach(label => {
      const input = label.parentElement.querySelector('input:not([type="hidden"]), textarea, select');
      if (input?.id && !label.hasAttribute('for')) label.htmlFor = input.id;
    });
  }

  window.AdminBoard = {
    render,
    imageUrl,
    startReordering() { organizing = !organizing; render(); if (organizing) announce('Selecione vários imóveis e arraste pela alça, ou use os botões de posição.'); },
    previewEditor(index) { preview(currentImages, currentImageTags, index, $('f-nome').value || 'Fotos do imóvel'); }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
