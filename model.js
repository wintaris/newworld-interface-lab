/* Геометрия и формат переносимого макета. Не зависит от DOM. */
(function (host) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const numeric = {
    x: [-20000, 20000], y: [-20000, 20000], w: [1, 12000], h: [1, 12000], z: [-1000, 1000],
    opacity: [0, 1], fillOpacity: [0, 1], frameOpacity: [0, 1], frameWidth: [0, 100], radius: [0, 2000],
    fontSize: [2, 256], fontWeight: [100, 900], lineHeight: [.5, 5], letterSpacing: [-10, 100],
    padding: [0, 1000], gap: [-100, 1000], columns: [1, 100], value: [0, 1], rotation: [-360, 360]
  };
  const enums = {
    kind: ['panel', 'group', 'text', 'button', 'input', 'checkbox', 'image', 'slot', 'progress'],
    frame: ['ornate', 'simple', 'bottom', 'none'], layout: ['free', 'row', 'column', 'grid'], progressMode: ['bar', 'radial'],
    align: ['left', 'center', 'right'], valign: ['top', 'center', 'bottom'], imageFit: ['contain', 'cover', 'fill'],
    anchor: ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'],
    resizeMode: ['scale', 'layout'], autoSize: ['none', 'grow'], textRenderer: ['browser', 'atlas', 'bitmap'], dock: ['none','fill']
  };
  const colors = ['textColor', 'fillColor', 'frameColor'];
  const stringKeys = ['name', 'text', 'font', 'asset', 'source', 'notes', 'templateKey', 'partKey', 'bitmapFont', 'hoverAsset', 'pressedAsset'];
  const booleanKeys = ['visible', 'locked', 'clipChildren', 'italic', 'uppercase', 'selectAsBlock', 'scaleOwner', 'shadow'];
  const colorOK = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  function blankNode(id, kind, parent, name) {
    return {
      id, name: name || 'Новый элемент', kind, parent, x: 24, y: 72, w: 180, h: kind === 'text' ? 32 : 80,
      z: 0, visible: true, locked: false, opacity: 1, frame: ['panel', 'slot'].includes(kind) ? 'ornate' : ['button', 'input', 'checkbox'].includes(kind) ? 'simple' : 'none',
      fillOpacity: ['panel', 'slot', 'button', 'input'].includes(kind) ? .92 : 0, frameOpacity: 1, frameWidth: ['panel', 'slot'].includes(kind) ? 8 : 1,
      radius: 0, text: ['text', 'button', 'input'].includes(kind) ? name || 'Текст' : '', fontSize: 18, fontWeight: 600, align: 'left', valign: 'center',
      lineHeight: 1.25, letterSpacing: 0, padding: 0, layout: 'free', gap: 8, columns: 3, anchor: 'top-left', asset: '', imageFit: 'contain', value: .65, source: 'custom/' + id,
      resizeMode: 'scale', autoSize: 'none', templateKey: '', partKey: '', selectAsBlock: false, scaleOwner: false, textRenderer: 'browser'
    };
  }
  function resolve(screen, viewport) {
    const result = new Map(), byId = new Map(screen.nodes.map(n => [n.id, n]));
    const ui = screen.runtimeScale;
    const scale = ui ? Math.min(ui.percent / 100, (viewport.w - (ui.margin || 0)) / ui.widthLimit, (viewport.h - (ui.margin || 0)) / ui.heightLimit) : 1;
    const children = new Map();
    for (const n of screen.nodes) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
    function visit(node, parentBox, parentVisible, parentOpacity, flowPosition) {
      let w = node.w, h = node.h;
      let x = node.x, y = node.y;
      if (node.parent === null && screen.fullscreen) { w = viewport.w / scale; h = viewport.h / scale; x = 0; y = 0; }
      else if (node.dock==='fill') {x=0;y=0;w=parentBox.w;h=parentBox.h;}
      else if (flowPosition) { x = flowPosition.x; y = flowPosition.y; }
      else {
        const anchor = node.anchor || 'top-left';
        if (anchor.includes('right')) x = parentBox.w - w - node.x;
        else if (anchor === 'center' || anchor.endsWith('-center')) x = (parentBox.w - w) / 2 + node.x;
        if (anchor.includes('bottom')) y = parentBox.h - h - node.y;
        else if (anchor === 'center' || anchor.startsWith('center-')) y = (parentBox.h - h) / 2 + node.y;
      }
      const box = {x: parentBox.x + x, y: parentBox.y + y, localX: x, localY: y, w, h,
        visible: parentVisible && node.visible, opacity: parentOpacity * node.opacity};
      box.renderScale = scale;
      result.set(node.id, box);
      const kids = children.get(node.id) || [], flowKids = kids.filter(n => n.visible), positions = new Map();
      const pad = node.padding || 0, gap = node.gap || 0;
      if (node.layout === 'row' || node.layout === 'column') {
        let offset = pad;
        for (const child of flowKids) {
          positions.set(child.id, {x: node.layout === 'row' ? offset : pad, y: node.layout === 'column' ? offset : pad});
          offset += (node.layout === 'row' ? child.w : child.h) + gap;
        }
      }
      if (node.layout === 'grid') {
        const cols = Math.max(1, Math.floor(node.columns)), widths = Array(cols).fill(0), heights = [];
        flowKids.forEach((child, i) => { widths[i % cols] = Math.max(widths[i % cols], child.w); const row = Math.floor(i / cols); heights[row] = Math.max(heights[row] || 0, child.h); });
        flowKids.forEach((child, i) => { const col = i % cols, row = Math.floor(i / cols); positions.set(child.id, {x: pad + widths.slice(0, col).reduce((a, b) => a + b + gap, 0), y: pad + heights.slice(0, row).reduce((a, b) => a + b + gap, 0)}); });
      }
      for (const child of kids) visit(child, box, box.visible, box.opacity, positions.get(child.id));
    }
    const root = byId.get(screen.root);
    if (root) visit(root, {x: 0, y: 0, w: viewport.w / scale, h: viewport.h / scale}, true, 1);
    if (scale !== 1) for (const box of result.values()) for (const key of ['x', 'y', 'localX', 'localY', 'w', 'h']) box[key] = Math.round(box[key] * scale * 1000) / 1000;
    if (screen.fullscreen && root) Object.assign(result.get(root.id), {w: viewport.w, h: viewport.h});
    return result;
  }
  function setWorldPosition(node, x, y, boxes, viewport) {
    const parent = boxes.get(node.parent) || {x: 0, y: 0, w: viewport.w, h: viewport.h};
    const scale = boxes.get(node.id)?.renderScale || parent.renderScale || 1;
    const localX = (x - parent.x) / scale, localY = (y - parent.y) / scale, anchor = node.anchor;
    const pw = parent.w / scale, ph = parent.h / scale;
    node.x = anchor.includes('right') ? pw - node.w - localX : (anchor === 'center' || anchor.endsWith('-center')) ? localX - (pw - node.w) / 2 : localX;
    node.y = anchor.includes('bottom') ? ph - node.h - localY : (anchor === 'center' || anchor.startsWith('center-')) ? localY - (ph - node.h) / 2 : localY;
    node.x = Math.round(node.x); node.y = Math.round(node.y);
  }
  function descendants(screen, id) {
    const found = new Set([id]);
    let changed = true;
    while (changed) { changed = false; for (const node of screen.nodes) if (found.has(node.parent) && !found.has(node.id)) { found.add(node.id); changed = true; } }
    return found;
  }
  function detachFlow(screen, parentId, boxes) {
    const parent = screen.nodes.find(n => n.id === parentId);
    if (!parent || parent.layout === 'free') return;
    for (const child of screen.nodes.filter(n => n.parent === parentId)) {
      const box = boxes.get(child.id); child.x = Math.round(box.localX / box.renderScale); child.y = Math.round(box.localY / box.renderScale); child.anchor = 'top-left';
    }
    parent.layout = 'free';
  }
  function blockRoot(screen, id, predicate = n => n.selectAsBlock) {
    const byId = new Map(screen.nodes.map(n => [n.id, n])); let n = byId.get(id);
    while (n) { if (predicate(n)) return n; n = byId.get(n.parent); }
    return null;
  }
  function linkedNodes(screen, id) {
    const n = screen.nodes.find(n => n.id === id), root = blockRoot(screen, id, n => !!n.templateKey);
    if (!n || !root) return n ? [n] : [];
    if (root.id === id) return screen.nodes.filter(n => n.templateKey === root.templateKey);
    if (!n.partKey) return [n];
    return screen.nodes.filter(peer => peer.partKey === n.partKey && blockRoot(screen, peer.id, r => !!r.templateKey)?.templateKey === root.templateKey);
  }
  function scaleFamily(screen, root, sx, sy) {
    const family = descendants(screen, root.id);
    for (const n of screen.nodes) if (family.has(n.id)) {
      for (const key of ['w', 'h', 'x', 'y', 'fontSize', 'frameWidth', 'radius', 'padding', 'gap', 'letterSpacing']) {
        if (n[key] === undefined || (n.id === root.id && ['x', 'y'].includes(key))) continue;
        const ratio = ['w', 'x'].includes(key) ? sx : ['h', 'y'].includes(key) ? sy : Math.min(sx, sy);
        const limits = numeric[key]; n[key] = Math.round(Math.max(limits[0], Math.min(limits[1], n[key] * ratio)) * 1000) / 1000;
      }
    }
  }
  function growParents(screen) {
    const byId = new Map(screen.nodes.map(n => [n.id, n]));
    const depth = n => { let d = 0; while (n.parent && byId.has(n.parent)) { n = byId.get(n.parent); d++; } return d; };
    for (const parent of [...screen.nodes].sort((a,b) => depth(b) - depth(a))) {
      if (parent.autoSize !== 'grow' || parent.parent === null && screen.fullscreen) continue;
      const kids = screen.nodes.filter(n => n.parent === parent.id && n.visible);
      if (parent.layout === 'column') { parent.w = Math.max(parent.w, ...kids.map(n => n.w + 2 * parent.padding)); parent.h = Math.max(parent.h, kids.reduce((sum,n) => sum + n.h, 0) + Math.max(0,kids.length-1) * parent.gap + 2 * parent.padding); }
      else if (parent.layout === 'row') { parent.w = Math.max(parent.w, kids.reduce((sum,n) => sum + n.w, 0) + Math.max(0,kids.length-1) * parent.gap + 2 * parent.padding); parent.h = Math.max(parent.h, ...kids.map(n => n.h + 2 * parent.padding)); }
      else { parent.w = Math.max(parent.w, ...kids.filter(n => n.anchor === 'top-left').map(n => n.x + n.w + parent.padding)); parent.h = Math.max(parent.h, ...kids.filter(n => n.anchor === 'top-left').map(n => n.y + n.h + parent.padding)); }
      parent.w = Math.min(12000, parent.w); parent.h = Math.min(12000, parent.h);
    }
  }
  function resizeNode(screen, id, width, height, linked = true) {
    let item = screen.nodes.find(n => n.id === id); if (!item) return;
    if (item.scaleOwner) {
      const owner = blockRoot(screen, item.parent, n => n.selectAsBlock);
      if (owner) { width = owner.w * width / item.w; height = owner.h * height / item.h; item = owner; }
    }
    const peers = linked ? linkedNodes(screen, item.id) : [item];
    for (const n of peers) {
      const w = Math.max(1, Math.min(12000,width)), h = Math.max(1, Math.min(12000,height));
      if (n.resizeMode !== 'layout') scaleFamily(screen, n, w / n.w, h / n.h);
      else { n.w = w; n.h = h; }
    }
    growParents(screen);
  }
  function applyProperty(screen, id, key, value, linked = true) {
    const n = screen.nodes.find(n => n.id === id); if (!n) return;
    if (key === 'w' || key === 'h') { resizeNode(screen,id,key === 'w' ? value : n.w,key === 'h' ? value : n.h,linked); return; }
    const independent = ['text','asset','name','source','notes','parent','templateKey','partKey','x','y','anchor','visible','locked'];
    const peers = linked && (!independent.includes(key) || ['x','y'].includes(key) && n.partKey) ? linkedNodes(screen,id) : [n];
    for (const peer of peers) peer[key] = value;
    growParents(screen);
  }
  function validate(input, catalog) {
    if (!input || input.schema !== 'newworld-interface-editor' || input.version !== 1) throw Error('Это не макет Interface Lab версии 1.');
    if (catalog.baselineId && input.baselineId !== catalog.baselineId) throw Error('Макет создан на другой основе. Сохрани старый JSON отдельно; для текущих окон нужен макет синхронизированной версии.');
    if (!Array.isArray(input.screens) || input.screens.length > 200) throw Error('Некорректный список экранов.');
    const assetIds = new Set(catalog.assets.map(a => a.id)), screenIds = new Set(), clean = clone(catalog);
    const theme = input.theme || {}, numericTheme = ['fontSize', 'frameWidth', 'fillOpacity'];
    for (const key of colors) if (theme[key] !== undefined) { if (!colorOK(theme[key])) throw Error('Некорректный цвет темы.'); clean.theme[key] = theme[key]; }
    if (theme.font !== undefined) { if (typeof theme.font !== 'string' || theme.font.length > 120) throw Error('Некорректный шрифт темы.'); clean.theme.font = theme.font; }
    for (const key of numericTheme) if (theme[key] !== undefined) { if (!Number.isFinite(theme[key]) || theme[key] < numeric[key][0] || theme[key] > numeric[key][1]) throw Error('Некорректная тема: ' + key); clean.theme[key] = theme[key]; }
    let total = 0;
    clean.screens = input.screens.map(raw => {
      if (!raw || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id) || screenIds.has(raw.id)) throw Error('Повторяющийся или некорректный ID экрана.');
      screenIds.add(raw.id);
      const original = catalog.screens.find(s => s.id === raw.id);
      if (!original) throw Error('Неизвестный экран: ' + raw.id);
      if (!Array.isArray(raw.nodes) || (total += raw.nodes.length) > 12000) throw Error('Слишком много элементов.');
      const ids = new Set();
      const nodes = raw.nodes.map(n => {
        if (!n || typeof n.id !== 'string' || !/^[\w-]{1,150}$/.test(n.id) || ids.has(n.id)) throw Error('Некорректный ID элемента: ' + raw.id);
        ids.add(n.id);
        if (!enums.kind.includes(n.kind)) throw Error('Неизвестный тип элемента.');
        if (n.parent !== null && typeof n.parent !== 'string') throw Error('Не указан родитель.');
        const out = blankNode(n.id, n.kind, n.parent, n.name);
        for (const [key, limits] of Object.entries(numeric)) if (n[key] !== undefined) {
          if (!Number.isFinite(n[key]) || n[key] < limits[0] || n[key] > limits[1]) throw Error('Некорректное значение ' + key + ' в ' + raw.id + '/' + n.id);
          out[key] = n[key];
        }
        for (const [key, options] of Object.entries(enums)) if (n[key] !== undefined) { if (!options.includes(n[key])) throw Error('Недопустимое значение ' + key); out[key] = n[key]; }
        for (const key of stringKeys) if (n[key] !== undefined) { if (typeof n[key] !== 'string' || n[key].length > (key === 'text' || key === 'notes' ? 20000 : 500)) throw Error('Некорректный текст ' + key); out[key] = n[key]; }
        for (const key of booleanKeys) if (n[key] !== undefined) { if (typeof n[key] !== 'boolean') throw Error('Некорректный флаг ' + key); out[key] = n[key]; }
        for (const key of colors) if (n[key] !== undefined) { if (!colorOK(n[key])) throw Error('Некорректный цвет ' + key); out[key] = n[key]; }
        if (out.asset && !assetIds.has(out.asset)) throw Error('Неизвестная картинка: ' + out.asset);
        return out;
      });
      const root = nodes.find(n => n.id === raw.root);
      if (!root || root.parent !== null || nodes.filter(n => n.parent === null).length !== 1) throw Error('Некорректный корень экрана.');
      const byId = new Map(nodes.map(n => [n.id, n]));
      for (const node of nodes) {
        const visited = new Set(); let cursor = node;
        while (cursor) { if (visited.has(cursor.id)) throw Error('Цикл в родителях.'); visited.add(cursor.id); if (visited.size > 64) throw Error('Слишком глубокая вложенность элементов.'); if (cursor.parent === null) break; if (!byId.has(cursor.parent)) throw Error('Отсутствует родитель.'); cursor = byId.get(cursor.parent); }
      }
      const result = {...clone(original), fullscreen: Boolean(raw.fullscreen), nodes};
      if (result.runtimeScale && raw.runtimeScale) {
        const percent = raw.runtimeScale.percent;
        if (!Number.isFinite(percent) || percent < 20 || percent > 150) throw Error('Некорректный масштаб игрового окна.');
        result.runtimeScale.percent = percent;
      }
      return result;
    });
    if (catalog.screens.some(s => !screenIds.has(s.id))) throw Error('В файле не хватает экранов. Экспортируй полный макет.');
    clean.editedAt = typeof input.editedAt === 'string' ? input.editedAt.slice(0, 100) : '';
    clean.editorView = input.editorView && typeof input.editorView === 'object' ? {
      screen: screenIds.has(input.editorView.screen) ? input.editorView.screen : 'Inventory',
      width: Number.isFinite(input.editorView.width) ? Math.max(640, Math.min(6000, input.editorView.width)) : 1920,
      height: Number.isFinite(input.editorView.height) ? Math.max(480, Math.min(4000, input.editorView.height)) : 1080
    } : {screen: 'Inventory', width: 1920, height: 1080};
    return clean;
  }
  function exportData(data, catalog, view) {
    const result = validate(data, catalog);
    result.editedAt = new Date().toISOString();
    result.editorView = clone(view);
    result.changes = [];
    for (const screen of result.screens) {
      const base = catalog.screens.find(s => s.id === screen.id), original = new Map(base.nodes.map(n => [n.id, n]));
      if (base.fullscreen !== screen.fullscreen) result.changes.push({screen: screen.id, property: 'fullscreen', value: screen.fullscreen});
      if (JSON.stringify(base.runtimeScale)!==JSON.stringify(screen.runtimeScale)) result.changes.push({screen:screen.id,property:'runtimeScale',value:screen.runtimeScale});
      for (const node of screen.nodes) {
        const before = original.get(node.id), changed = {};
        for (const [key, value] of Object.entries(node)) if (!before || JSON.stringify(value) !== JSON.stringify(before[key])) changed[key] = value;
        if (Object.keys(changed).length) result.changes.push({screen: screen.id, id: node.id, source: node.source, added: !before, properties: changed});
      }
      for (const node of base.nodes) if (!screen.nodes.some(n => n.id === node.id)) result.changes.push({screen: screen.id, id: node.id, source: node.source, deleted: true});
    }
    return result;
  }
  host.InterfaceModel = {clone, numeric, enums, colors, blankNode, resolve, setWorldPosition, descendants, detachFlow, validate, exportData, colorOK, blockRoot, linkedNodes, resizeNode, applyProperty, growParents, scaleFamily};
  if (typeof module !== 'undefined') module.exports = host.InterfaceModel;
})(typeof window !== 'undefined' ? window : globalThis);
