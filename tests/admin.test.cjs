const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../admin/core.js');
const properties = () => [
  { id: 'a' }, { id: 'archived', arquivado: true }, { id: 'b' },
  { id: 'c' }, { id: 'trash', lixeira: true }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'default', isDefault: true }
];
test('featured tray mirrors the public site: first six active, non-default properties', () => {
  assert.deepEqual(core.featured(properties()).map(p => p.id), ['a', 'b', 'c', 'd', 'e', 'f']);
});
test('moving a non-contiguous selection preserves relative order and hidden slots', () => {
  const source = properties();
  const next = core.move(source, ['e', 'b'], 0);
  assert.deepEqual(next.filter(core.active).map(p => p.id), ['b', 'e', 'a', 'c', 'd', 'f', 'g', 'default']);
  assert.equal(next[1], source[1]);
  assert.equal(next[4], source[4]);
  assert.deepEqual(source, properties());
});
test('moving to end or a numbered position preserves every record exactly once', () => {
  const source = properties();
  const end = core.move(source, ['b', 'e'], 100);
  assert.deepEqual(end.filter(core.active).map(p => p.id).slice(-2), ['b', 'e']);
  const position = core.move(source, ['a', 'c'], 2);
  assert.deepEqual(position.filter(core.active).map(p => p.id).slice(2, 4), ['a', 'c']);
  assert.equal(new Set(position.map(p => p.id)).size, source.length);
  assert.deepEqual(core.move(source, source.map(p => p.id), 1), source);
});
test('invalid permutations cannot silently delete or duplicate a property', () => {
  assert.throws(() => core.reorder(properties(), ['a', 'a']));
  assert.throws(() => core.reorder(properties(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'unknown']));
});
const complete = () => ({ nome: 'Apartamento', tipo: 'Apartamento', imagens: Array.from({ length: 8 }, (_, i) => `photo-${i}`), descricao: 'Uma descrição detalhada do imóvel e dos ambientes. '.repeat(3), preco: 'R$ 500.000', cidade: 'Itajaí', bairro: 'Centro', areaUtil: '80 m²' });
test('a complete listing can score ten without video, badges or condominium', () => {
  assert.equal(core.quality(complete()).score, 10);
  assert.equal(core.quality({}).score, 0);
  assert.equal(core.quality({ ...complete(), youtube: 'https://youtu.be/example', caracteristicas: ['Varanda'], caracteristicasCondominio: ['Piscina'] }).score, 10);
});
test('photo and description progress earns partial credit and duplicate photos do not inflate quality', () => {
  const sparse = { ...complete(), imagens: ['one'], descricao: 'Descrição curta.' };
  assert(core.quality(sparse).score > core.quality({ ...sparse, imagens: [], descricao: '' }).score);
  assert.equal(core.quality({ ...sparse, imagens: ['one', 'one', 'one'] }).score, core.quality(sparse).score);
});
test('land and commercial properties have fair photo targets', () => {
  assert.equal(core.quality({ ...complete(), tipo: 'Lote/Terreno', imagens: ['a', 'b', 'c'] }).score, 10);
  assert.equal(core.quality({ ...complete(), tipo: 'Sala Comercial', imagens: ['a', 'b', 'c', 'd', 'e', 'f'] }).score, 10);
});
test('zero areas, decorative HTML and invalid video links earn no points', () => {
  assert.equal(core.quality({ areaUtil: '0', preco: 'R$ 0', youtube: 'javascript:alert(1)', descricao: '<div>'.repeat(40) }).score, 0);
  assert.equal(core.quality({ youtube: 'https://youtube.com.evil.test/watch' }).score, 0);
  assert.equal(core.quality({ preco: 'Sob consulta' }).score, 1.5);
});
test('quality is finite and bounded even with every bonus and large inputs', () => {
  for (let count = 0; count <= 30; count++) {
    const result = core.quality({ ...complete(), imagens: Array.from({ length: count }, (_, i) => String(i)), youtube: 'https://youtube.com/watch?v=example', caracteristicas: ['A'], caracteristicasCondominio: ['B'] });
    assert(Number.isFinite(result.score) && result.score >= 0 && result.score <= 10);
  }
});
test('photo reordering preserves the room associated with each selected image, including duplicate URLs', () => {
  const images = ['same.jpg', 'b.jpg', 'same.jpg', 'd.jpg'];
  const tags = ['Sala', 'Cozinha', 'Quarto', 'Fachada'];
  assert.deepEqual(core.reorderPhotos(images, tags, [1, 3, 0, 2]), {
    images: ['b.jpg', 'd.jpg', 'same.jpg', 'same.jpg'], tags: ['Cozinha', 'Fachada', 'Sala', 'Quarto']
  });
  assert.deepEqual(images, ['same.jpg', 'b.jpg', 'same.jpg', 'd.jpg']);
  assert.deepEqual(tags, ['Sala', 'Cozinha', 'Quarto', 'Fachada']);
});
test('photo reordering rejects incomplete or duplicated positions without dropping images', () => {
  for (const order of [[0], [1, 1], [0, 2], [0, -1], [0, 0.5]]) {
    assert.throws(() => core.reorderPhotos(['a.jpg', 'b.jpg'], [], order));
  }
  assert.deepEqual(core.reorderPhotos(['a.jpg', 'b.jpg'], [], [1, 0]), { images: ['b.jpg', 'a.jpg'], tags: ['', ''] });
  assert.deepEqual(core.reorderPhotos([], [], []), { images: [], tags: [] });
});
