/* Sortable's bundled MultiDrag folds selected photos into one moving stack and
 * unfolds them at the destination. Keep those DOM nodes alive through onEnd so
 * rebuilding previews never interrupts the drop animation. */
(function () {
  let sortable = null;
  let selected = new Set();
  let updating = false;
  const $ = id => document.getElementById(id);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const thumbs = () => [...$('image-preview-container').children].filter(el => el.matches('.img-thumb') && !el.classList.contains('photo-drag-fallback'));

  function announce(message) { $('photo-selection-status').textContent = message; }

  function updateSelection() {
    const all = thumbs();
    for (const thumb of all) {
      const checked = selected.has(Number(thumb.dataset.index));
      if (sortable) {
        checked ? Sortable.utils.select(thumb) : Sortable.utils.deselect(thumb);
      }
      thumb.classList.toggle('photo-selected', checked);
      thumb.querySelector('[data-photo-select]').checked = checked;
    }
    $('select-all-photos').checked = all.length > 0 && selected.size === all.length;
    $('select-all-photos').indeterminate = selected.size > 0 && selected.size < all.length;
    $('select-all-photos').disabled = !all.length;
    $('photo-selection-actions').hidden = !selected.size;
    $('photo-selection-count').textContent = `${selected.size} ${selected.size === 1 ? 'foto selecionada' : 'fotos selecionadas'}`;
  }

  function reindex() {
    const all = thumbs();
    selected = new Set();
    all.forEach((thumb, index) => {
      thumb.dataset.index = index;
      thumb.setAttribute('aria-label', `Foto ${index + 1}${index === 0 ? ', capa do imóvel' : ''}`);
      if (thumb.classList.contains('photo-selected')) selected.add(index);
      thumb.querySelector('img').alt = `Foto ${index + 1}`;
      thumb.querySelector('.img-thumb-grip').setAttribute('aria-label', `Arrastar foto ${index + 1}`);
      thumb.querySelector('[data-photo-select]').setAttribute('aria-label', `Selecionar foto ${index + 1}`);
      thumb.querySelector('.img-zoom-btn').setAttribute('aria-label', `Ampliar foto ${index + 1}`);
      thumb.querySelector('.img-remove-btn').setAttribute('aria-label', `Remover foto ${index + 1}`);
      const menu = thumb.querySelector('.img-tag-menu');
      menu.id = `img-tag-menu-${index}`;
      menu.innerHTML = tagMenuOptionsHTML(index);
    });
    updateSelection();
  }

  function applyOrder(nodes, animate = false) {
    const order = nodes.map(el => Number(el.dataset.index));
    const next = AdminCore.reorderPhotos(currentImages, currentImageTags, order);
    if (animate && sortable) sortable.captureAnimationState();
    currentImages = next.images;
    currentImageTags = next.tags;
    if (animate) nodes.forEach(el => $('image-preview-container').appendChild(el));
    reindex();
    if (animate && sortable) sortable.animateAll();
    return order.some((originalIndex, index) => originalIndex !== index);
  }

  function destroy() {
    updating = true;
    // Also release programmatic selections before MultiDrag has started its first drag.
    if (sortable) thumbs().forEach(thumb => Sortable.utils.deselect(thumb));
    sortable?.destroy();
    sortable = null;
    updating = false;
  }

  function render() {
    destroy();
    selected = new Set([...selected].filter(index => index < currentImages.length));
    const container = $('image-preview-container');
    container.replaceChildren();
    currentImages.forEach((src, index) => {
      const tag = currentImageTags[index] || '';
      const thumb = document.createElement('div');
      thumb.className = 'img-thumb';
      thumb.dataset.index = index;
      thumb.setAttribute('role', 'group');
      thumb.setAttribute('aria-label', `Foto ${index + 1}${index === 0 ? ', capa do imóvel' : ''}`);
      // Inline actions read the CURRENT index after a drop; they never capture the old one.
      const indexNow = "Number(this.closest('.img-thumb').dataset.index)";
      thumb.innerHTML = `
        <button type="button" class="img-thumb-grip" aria-label="Arrastar foto ${index + 1}" title="Arraste para mover as fotos selecionadas"><iconify-icon icon="lucide:grip-vertical" aria-hidden="true"></iconify-icon></button>
        <img src="${escapeHtml(AdminBoard.imageUrl(src))}" alt="Foto ${index + 1}" loading="lazy" draggable="false">
        <button type="button" class="img-zoom-btn" onclick="AdminBoard.previewEditor(${indexNow})" aria-label="Ampliar foto ${index + 1}" title="Ver foto inteira"><iconify-icon icon="lucide:expand" aria-hidden="true"></iconify-icon></button>
        <label class="img-select" title="Selecionar foto"><input type="checkbox" data-photo-select aria-label="Selecionar foto ${index + 1}"><span><iconify-icon icon="lucide:check" aria-hidden="true"></iconify-icon></span></label>
        <button type="button" class="img-remove-btn" onclick="removeImage(${indexNow})" aria-label="Remover foto ${index + 1}" title="Remover foto">&times;</button>
        <button type="button" class="img-tag-btn${tag ? ' tagged' : ''}" onclick="toggleTagMenu(${indexNow}, event)"><iconify-icon icon="mdi:tag-outline" aria-hidden="true"></iconify-icon><span>${escapeHtml(tag) || 'Marcar cômodo'}</span></button>
        <div class="img-tag-menu" id="img-tag-menu-${index}">${tagMenuOptionsHTML(index)}</div>`;
      container.appendChild(thumb);
    });
    if (typeof Sortable !== 'undefined' && Sortable.utils.select) {
      sortable = new Sortable(container, {
        draggable: '.img-thumb', handle: '.img-thumb-grip',
        multiDrag: true, selectedClass: 'photo-selected', avoidImplicitDeselect: true,
        filter: 'input, label, .img-zoom-btn, .img-remove-btn, .img-tag-btn, .img-tag-menu', preventOnFilter: false,
        animation: reducedMotion.matches ? 0 : 200,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fallbackOnBody: false, fallbackTolerance: 4,
        ghostClass: 'photo-drag-ghost', chosenClass: 'photo-drag-chosen', fallbackClass: 'photo-drag-fallback',
        scroll: $('property-dialog').querySelector('.dialog-body'), scrollSensitivity: 60, scrollSpeed: 10,
        onChoose(event) {
          event.item.dataset.dragCount = selected.has(Number(event.item.dataset.index)) ? selected.size : 1;
        },
        onSelect(event) { if (!updating) { selected.add(Number(event.item.dataset.index)); updateSelection(); } },
        onDeselect(event) { if (!updating) { selected.delete(Number(event.item.dataset.index)); updateSelection(); } },
        onStart(event) {
          const count = event.items?.length || 1;
          event.item.dataset.dragCount = count;
          container.classList.add('photos-dragging');
          announce(`Movendo ${count} ${count === 1 ? 'foto' : 'fotos'}…`);
        },
        onEnd(event) {
          container.classList.remove('photos-dragging');
          const count = event.items?.length || 1;
          try {
            const changed = applyOrder(thumbs());
            announce(changed ? `${count} ${count === 1 ? 'foto reposicionada' : 'fotos reposicionadas'}. Salve o imóvel para confirmar.` : 'Ordem das fotos mantida.');
          } catch (_) {
            render();
            announce('Não foi possível reorganizar as fotos. Tente novamente.');
          }
        }
      });
    }
    updateSelection();
  }

  function moveSelected(toEnd) {
    const all = thumbs();
    const moving = all.filter(el => selected.has(Number(el.dataset.index)));
    if (!moving.length) return;
    const rest = all.filter(el => !selected.has(Number(el.dataset.index)));
    applyOrder(toEnd ? [...rest, ...moving] : [...moving, ...rest], true);
    announce(`${moving.length} foto(s) movida(s) para ${toEnd ? 'o fim' : 'o início'}. Salve o imóvel para manter a nova ordem.`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('image-preview-container').addEventListener('change', event => {
      if (!event.target.matches('[data-photo-select]')) return;
      const index = Number(event.target.closest('.img-thumb').dataset.index);
      event.target.checked ? selected.add(index) : selected.delete(index);
      updateSelection();
    });
    $('select-all-photos').addEventListener('change', event => {
      selected = event.target.checked ? new Set(currentImages.map((_, index) => index)) : new Set();
      updateSelection();
    });
    $('clear-photo-selection').addEventListener('click', () => { selected.clear(); updateSelection(); });
    $('photos-move-first').addEventListener('click', () => moveSelected(false));
    $('photos-move-last').addEventListener('click', () => moveSelected(true));
    $('property-dialog').addEventListener('close', () => { destroy(); selected.clear(); });
    reducedMotion.addEventListener('change', () => sortable?.option('animation', reducedMotion.matches ? 0 : 200));
  });

  window.AdminPhotos = {
    render,
    reset() { destroy(); selected.clear(); announce(''); },
    beforeRemove(index) {
      selected = new Set([...selected].filter(value => value !== index).map(value => value > index ? value - 1 : value));
    }
  };
})();
