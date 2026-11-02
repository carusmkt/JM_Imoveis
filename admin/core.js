/* Pure helpers shared by the static admin and its regression tests. */
(function (root) {
  const active = property => !property.arquivado && !property.lixeira;
  const featured = properties => properties.filter(active).filter(p => !p.isDefault).slice(0, 6);

  // Only published slots change: archived and trashed properties keep their place.
  function reorder(properties, ids) {
    const published = properties.filter(active);
    const byId = new Map(published.map(p => [p.id, p]));
    if (ids.length !== published.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
      throw new Error('A nova ordem deve conter todos os imóveis publicados uma única vez.');
    }
    let index = 0;
    return properties.map(p => active(p) ? byId.get(ids[index++]) : p);
  }

  // Position is a zero-based gap in the list AFTER removing the moving group.
  function move(properties, selectedIds, position) {
    const selected = new Set(selectedIds);
    const published = properties.filter(active);
    const moving = published.filter(p => selected.has(p.id));
    const rest = published.filter(p => !selected.has(p.id));
    const gap = Math.max(0, Math.min(rest.length, Number(position) || 0));
    rest.splice(gap, 0, ...moving);
    return reorder(properties, rest.map(p => p.id));
  }

  function quality(data) {
    const text = value => String(value || '').trim();
    const positive = value => {
      const raw = text(value).replace(/[^\d,.]/g, '');
      return /[1-9]/.test(raw) && Number(raw.replace(/\./g, '').replace(',', '.')) > 0;
    };
    const type = text(data.tipo).toLocaleLowerCase('pt-BR');
    const land = /terreno|lote|fazenda|sítio|chácara/.test(type);
    const commercial = /comercial|prédio|loja|edifício/.test(type);
    const ideal = land ? 3 : commercial ? 6 : 8;
    const photos = new Set((data.imagens || []).filter(Boolean)).size;
    // HTML tags, Markdown decoration and icon markup do not make a description richer.
    const description = text(data.descricao).replace(/<[^>]*>|:icon\[[^\]]*\]:/g, ' ').replace(/[*_~=#`]/g, '').replace(/\s+/g, ' ').trim();
    const details = [];
    const add = (points, max, label, optional = false) => details.push({ points, max, ok: points === max, label, optional });
    add(Math.min(3, photos / ideal * 3), 3, photos >= ideal ? 'Boa cobertura de fotos' : `${photos} foto(s) · sugestão: ${ideal} fotos diferentes`);
    add(Math.min(2, description.length / 120 * 2), 2, description.length >= 120 ? 'Descrição completa' : 'Conte mais sobre o imóvel · sugestão: 120 caracteres');
    add(positive(data.preco) || positive(data.valorVenda) || positive(data.valorAluguel) || /sob consulta|a consultar/i.test(text(data.preco)) ? 1.5 : 0, 1.5, 'Preço ou valor sob consulta informado');
    add(data.cidade && data.bairro ? 1.5 : data.cidade ? 0.75 : 0, 1.5, 'Cidade e bairro informados');
    add(positive(data.areaUtil) || positive(data.areaTotal) ? 1 : 0, 1, 'Área útil ou total informada');
    add(text(data.nome) && text(data.tipo) ? 1 : 0, 1, 'Nome e tipo do imóvel informados');
    const base = details.reduce((sum, detail) => sum + detail.points, 0);
    // Optional extras can fill small gaps, but never make the result exceed ten.
    const features = (data.caracteristicas || []).length > 0;
    const condo = (data.caracteristicasCondominio || []).length > 0;
    let video = false;
    try {
      const url = new URL(text(data.youtube));
      video = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname) && (url.protocol === 'https:' || url.protocol === 'http:');
    } catch (_) { /* An empty or malformed link earns no bonus. */ }
    add(features ? 0.25 : 0, 0.25, 'Bônus: características do imóvel', true);
    add(condo ? 0.25 : 0, 0.25, 'Bônus: características do condomínio, se houver', true);
    add(video ? 0.5 : 0, 0.5, 'Bônus: vídeo do YouTube', true);
    return { score: Math.round(Math.max(0, Math.min(10, base + (features ? 0.25 : 0) + (condo ? 0.25 : 0) + (video ? 0.5 : 0))) * 10) / 10, detalhes: details };
  }

  // Use original indices, not URLs: repeated photos can have different room tags.
  function reorderPhotos(images, tags, order) {
    if (order.length !== images.length || new Set(order).size !== images.length ||
        order.some(index => !Number.isInteger(index) || index < 0 || index >= images.length)) {
      throw new Error('A nova ordem deve conter cada foto uma única vez.');
    }
    return { images: order.map(index => images[index]), tags: order.map(index => tags[index] || '') };
  }

  const api = { active, featured, reorder, move, quality, reorderPhotos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdminCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
