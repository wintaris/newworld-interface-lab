/* Локальная мастерская интерфейсов NewWorld. Игровые файлы не изменяются. */
(function () {
  'use strict';
  const M = window.InterfaceModel, catalog = window.INTERFACE_CATALOG, $ = id => document.getElementById(id);
  const STORAGE = 'newworld-interface-lab-game-sync-v2', ASSETS = new Map(catalog.assets.map(a => [a.id, a]));
  let data = M.clone(catalog), currentId = 'Inventory', selected = ['root'], viewport = {w: 1920, h: 1080};
  let zoom = .5, autoFit = true, boxes = new Map(), undoStack = [], redoStack = [], drag = null;
  let saveTimer, toastTimer, framePending = false, linkedHandle = null, fileQueue = Promise.resolve(), propertyTransaction = null;
  const kindNames = {panel: 'Панель', group: 'Группа', text: 'Текст', button: 'Кнопка', input: 'Поле ввода', checkbox: 'Флажок', image: 'Картинка', slot: 'Ячейка', progress: 'Прогресс'};
  const kindIcons = {panel: '▣', group: '◇', text: 'T', button: '▭', input: '▤', checkbox: '☑', image: '▧', slot: '□', progress: '━'};
  const anchorNames = {'top-left': 'Сверху слева', 'top-center': 'Сверху по центру', 'top-right': 'Сверху справа', 'center-left': 'По центру слева', center: 'Центр', 'center-right': 'По центру справа', 'bottom-left': 'Снизу слева', 'bottom-center': 'Снизу по центру', 'bottom-right': 'Снизу справа'};
  function screen() { return data.screens.find(s => s.id === currentId); }
  function node(id) { return screen().nodes.find(n => n.id === id); }
  function picked() { return selected.map(node).filter(Boolean); }
  function topPicked() { return picked().filter(n => !picked().some(other => other.id !== n.id && M.descendants(screen(), other.id).has(n.id))); }
  function linked() { return $('linkedEdits').checked; }
  function applyPicked(key, value) {
    const done = new Set();
    for (const n of picked()) { if(done.has(n.id))continue; M.applyProperty(screen(),n.id,key,value,linked()); if(linked())M.linkedNodes(screen(),n.id).forEach(peer=>done.add(peer.id)); }
  }
  function make(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
  function snapshot() { return JSON.stringify({theme: data.theme, screens: data.screens}); }
  function checkpoint() { const snap = snapshot(); if (undoStack.at(-1) !== snap) { undoStack.push(snap); if (undoStack.length > 70) undoStack.shift(); } redoStack = []; updateHistory(); }
  function updateHistory() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }
  function travel(from, to) {
    if (!from.length) return; to.push(snapshot()); const saved = JSON.parse(from.pop()); data.theme = saved.theme; data.screens = saved.screens;
    selected = selected.filter(id => node(id)); if (!selected.length) selected = [screen().root]; propertyTransaction = null;
    refresh(); save();
  }
  function payload() { return M.exportData(data, catalog, {screen: currentId, width: viewport.w, height: viewport.h}); }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      let output;
      try { output = payload(); localStorage.setItem(STORAGE, JSON.stringify(output)); $('saveStatus').textContent = linkedHandle ? 'Сохранено · JSON подключён' : 'Сохранено в браузере'; }
      catch (error) { $('saveStatus').textContent = 'Ошибка сохранения'; toast(error.message); return; }
      if (linkedHandle) {
        const target = linkedHandle, serialized = JSON.stringify(output, null, 2);
        fileQueue = fileQueue.then(async () => { const writer = await target.createWritable(); await writer.write(serialized); await writer.close(); }).catch(error => { linkedHandle = null; $('saveStatus').textContent = 'Файл отключён · копия в браузере'; $('linkFile').textContent = 'Связать JSON'; toast('Не удалось сохранить JSON: ' + error.message); });
      }
    }, 650);
  }
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) { data = M.validate(JSON.parse(saved), catalog); currentId = data.editorView.screen; viewport = {w: data.editorView.width, h: data.editorView.height}; }
  } catch (error) { setTimeout(() => toast('Сохранённый макет не загружен: ' + error.message), 400); }

  function showTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('screensTab').hidden = tab !== 'screens'; $('layersTab').hidden = tab !== 'layers';
  }
  function renderScreens() {
    const list = $('screenList'); list.replaceChildren(); const query = $('screenSearch').value.trim().toLocaleLowerCase('ru');
    const groups = new Map();
    data.screens.forEach((s, i) => { if (query && !(s.name + ' ' + s.id + ' ' + s.category).toLocaleLowerCase('ru').includes(query)) return; if (!groups.has(s.category)) groups.set(s.category, []); groups.get(s.category).push([s, i]); });
    for (const [name, screens] of groups) {
      list.append(make('div', 'category-title', name));
      screens.forEach(([s, index]) => {
        const button = make('button', 'screen-item' + (s.id === currentId ? ' active' : '')); button.dataset.screen = s.id; button.title = s.source;
        button.append(make('span', 'index', String(index + 1).padStart(2, '0')), make('span', '', s.name));
        if (s.style === 'redesigned') button.append(make('span', 'new-mark', 'НОВЫЙ'));
        button.addEventListener('click', () => switchScreen(s.id)); list.append(button);
      });
    }
    if (!groups.size) list.append(make('p', 'sidebar-note', 'Ничего не найдено.'));
    $('screenCount').textContent = data.screens.length;
    $('coverageText').textContent = catalog.coverage.schemeEntries + ' / ' + catalog.coverage.schemeEntries + ' определений';
  }
  function renderTree() {
    const tree = $('layerTree'); tree.replaceChildren();
    function branch(parent, depth) {
      screen().nodes.filter(n => n.parent === parent).forEach(n => {
        const row = make('div', 'layer-item' + (selected.includes(n.id) ? ' active' : '') + (!n.visible ? ' invisible' : '')); row.style.paddingLeft = (8 + depth * 13) + 'px'; row.dataset.layer = n.id;
        row.append(make('span', 'kind', n.templateKey ? '⛓' : kindIcons[n.kind]), make('span', 'node-name', n.name)); row.title = n.name + ' · ' + kindNames[n.kind] + (n.templateKey ? ' · общий шаблон '+n.templateKey : '');
        const eye = make('button', '', n.visible ? '◉' : '○'); eye.title = n.visible ? 'Скрыть' : 'Показать'; eye.setAttribute('aria-label', eye.title + ' ' + n.name);
        eye.addEventListener('click', event => { event.stopPropagation(); checkpoint(); n.visible = !n.visible; refresh(); save(); });
        const lock = make('button', '', n.locked ? '◆' : '◇'); lock.title = n.locked ? 'Разблокировать' : 'Заблокировать';
        lock.addEventListener('click', event => { event.stopPropagation(); checkpoint(); n.locked = !n.locked; refresh(); save(); }); row.append(eye, lock);
        row.addEventListener('click', event => select(n.id, event.shiftKey)); tree.append(row); branch(n.id, depth + 1);
      });
    }
    branch(null, 0);
  }
  function switchScreen(id) {
    currentId = id; selected = [screen().root]; propertyTransaction = null;
    refresh(); $('properties').scrollTop = 0; if (autoFit) fit(); save();
  }
  function select(id, additive = false) {
    if (!node(id)) return;
    if (additive) selected = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]; else selected = [id];
    propertyTransaction = null; renderTree(); renderInspector(); $('properties').scrollTop = 0; renderOverlay();
  }
  function renderStage() {
    const s = screen(), scene = $('scene'); boxes = M.resolve(s, viewport); scene.replaceChildren();
    $('viewport').style.width = viewport.w + 'px'; $('viewport').style.height = viewport.h + 'px';
    $('viewport').className = $('background').value;
    const gridStep = Math.max(1, Number($('gridStep').value) || 8);
    $('gridOverlay').style.backgroundSize = gridStep + 'px ' + gridStep + 'px'; $('gridOverlay').style.display = $('grid').checked ? 'block' : 'none';
    const children = new Map(); s.nodes.forEach(n => { if (!children.has(n.parent)) children.set(n.parent, []); children.get(n.parent).push(n); });
    function paint(n, parentEl) {
      const box = boxes.get(n.id); if (!box) return;
      const el = make('div', 'element' + (n.locked ? ' locked' : '')); el.dataset.id = n.id;
      const rs=box.renderScale||1;
      Object.assign(el.style, {left: box.localX + 'px', top: box.localY + 'px', width: box.w + 'px', height: box.h + 'px', opacity: n.opacity, zIndex: n.z,
        display: n.visible ? 'block' : 'none', overflow: n.clipChildren ? 'hidden' : 'visible', borderRadius: n.radius*rs + 'px'});
      const fillColor = n.fillColor || data.theme.fillColor, textColor = n.textColor || data.theme.textColor, frameColor = n.frameColor || data.theme.frameColor;
      if (n.fillOpacity > 0) { const fill = make('div', 'fill'); Object.assign(fill.style, {background: fillColor, opacity: n.fillOpacity, borderRadius: n.radius + 'px'}); el.append(fill); }
      if (n.kind === 'progress') {
        const bar = make('div', 'bar'); Object.assign(bar.style, {inset: '0 auto 0 0', width: (n.value * 100) + '%', background: fillColor, opacity: n.fillOpacity || 1, borderRadius: n.radius + 'px'});
        if (n.progressMode === 'radial') { Object.assign(bar.style, {inset: '0', width: '100%', zIndex: 1, background: 'conic-gradient(' + fillColor + ' 0deg ' + Math.round(n.value * 360) + 'deg, transparent ' + Math.round(n.value * 360) + 'deg 360deg)'}); }
        el.append(bar);
        if (el.firstElementChild?.classList.contains('fill')) el.firstElementChild.style.opacity = .15;
      }
      const previewState=selected.includes(n.id)?$('previewState')?.value:'normal';
      const art=previewState==='pressed'?(n.pressedAsset||n.asset):previewState==='hover'?(n.hoverAsset||n.asset):n.asset;
      if (art && ASSETS.has(art)) { const img = make('img', 'image'); img.src = ASSETS.get(art).url; img.alt = ''; img.draggable = false; img.style.objectFit = n.imageFit==='fill'?'fill':n.imageFit; img.style.borderRadius = n.radius*rs + 'px'; el.append(img); }
      if (n.frame !== 'none' && n.frameWidth > 0) {
        const frame = make('div', 'frame ' + n.frame); Object.assign(frame.style, {opacity: n.frameOpacity, borderWidth: n.frameWidth*rs + 'px', borderColor: frameColor, borderRadius: n.radius*rs + 'px', color: frameColor});
        if (n.frame === 'simple') frame.style.borderStyle = 'solid';
        if (n.frame === 'bottom') frame.style.boxShadow = 'inset 0 -' + n.frameWidth + 'px ' + frameColor;
        el.append(frame);
      }
      if (n.text && n.textRenderer && n.textRenderer!=='browser') {
        const canvas=make('canvas','content game-text');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';el.append(canvas);window.GameText.draw(canvas,n,box,catalog,textColor);
      } else if (n.text) {
        const content = make('div', 'content', n.uppercase ? n.text.toLocaleUpperCase('ru') : n.text); content.style.zIndex = 2;
        Object.assign(content.style, {fontFamily: n.font || data.theme.font, fontSize: n.fontSize*rs + 'px', fontWeight: n.fontWeight, color: textColor, fontStyle: n.italic ? 'italic' : 'normal',
          lineHeight: n.lineHeight, letterSpacing: n.letterSpacing*rs + 'px', padding: n.padding*rs + 'px', textAlign: n.align,
          alignItems: {top: 'flex-start', center: 'center', bottom: 'flex-end'}[n.valign], justifyContent: {left: 'flex-start', center: 'center', right: 'flex-end'}[n.align]}); el.append(content);
      }
      if (n.kind === 'checkbox' && n.value > .5) { const tick = make('span', 'tick', '✓'); tick.style.color = textColor; tick.style.fontSize = Math.min(box.w, box.h) * .8 + 'px'; el.append(tick); }
      if (selected.includes(n.id) && $('previewState')) el.classList.add('is-preview-' + $('previewState').value);
      parentEl.append(el); (children.get(n.id) || []).forEach(child => paint(child, el));
    }
    const root = node(s.root); if (root) paint(root, scene);
    renderOverlay();
  }
  function renderOverlay() {
    const overlay = $('selectionOverlay'); overlay.replaceChildren();
    const nodes = picked(), solo = nodes.length === 1;
    for (const n of nodes) {
      const box = boxes.get(n.id); if (!box || !box.visible) continue;
      const outline = make('div', 'select-box'); Object.assign(outline.style, {left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px', borderWidth: (1 / zoom) + 'px'});
      const label = make('span', 'selection-label', n.name); label.style.transform = 'scale(' + 1 / zoom + ')'; label.style.transformOrigin = 'bottom left'; outline.append(label);
      if (solo && !n.locked && !(n.id === screen().root && screen().fullscreen)) {
        for (const [key, x, y] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['e', 100, 50], ['se', 100, 100], ['s', 50, 100], ['sw', 0, 100], ['w', 0, 50]]) {
          const handle = make('span', 'resize-handle'); handle.dataset.handle = key; Object.assign(handle.style, {left: x + '%', top: y + '%', width: 8 / zoom + 'px', height: 8 / zoom + 'px', cursor: key + '-resize'}); outline.append(handle);
        }
      }
      overlay.append(outline);
    }
    const first = nodes[0], box = first && boxes.get(first.id);
    $('geometryStatus').textContent = box ? (nodes.length > 1 ? nodes.length + ' элементов · ' : '') + Math.round(box.w) + ' × ' + Math.round(box.h) + ' px · X ' + Math.round(box.x) + ' / Y ' + Math.round(box.y) : 'Выбери элемент на макете или в слоях';
  }
  function requestStage() { if (framePending) return; framePending = true; requestAnimationFrame(() => { framePending = false; renderStage(); }); }
  function setZoom(value, fitMode = false) { zoom = Math.max(.12, Math.min(2, value)); autoFit = fitMode; positionViewport(); renderOverlay(); }
  function positionViewport() {
    const area = $('stageScroll'), width = Math.max(area.clientWidth, viewport.w * zoom + 64), height = Math.max(area.clientHeight, viewport.h * zoom + 64);
    $('stageSpace').style.width = width + 'px'; $('stageSpace').style.height = height + 'px';
    Object.assign($('viewport').style, {left: Math.max(32, (width - viewport.w * zoom) / 2) + 'px', top: Math.max(32, (height - viewport.h * zoom) / 2) + 'px', transform: 'scale(' + zoom + ')'});
    $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  }
  function fit() {
    const area = $('stageScroll'), root = boxes.get(screen().root);
    const target = screen().fullscreen ? {x: 0, y: 0, w: viewport.w, h: viewport.h} : root;
    if (!target) return;
    setZoom(Math.min((area.clientWidth - 90) / target.w, (area.clientHeight - 90) / target.h, 1), true);
    const left = parseFloat($('viewport').style.left), top = parseFloat($('viewport').style.top);
    area.scrollLeft = left + (target.x + target.w / 2) * zoom - area.clientWidth / 2;
    area.scrollTop = top + (target.y + target.h / 2) * zoom - area.clientHeight / 2;
  }
  function refresh() {
    $('screenName').textContent = screen().name; $('screenStyle').textContent = screen().style === 'redesigned' ? 'Новый макет' : 'Макет текущего интерфейса';
    $('screenNote').textContent = (screen().note || 'Данные примера · изменения пока не применяются к игре');
    $('gameScaleLabel').hidden=!screen().runtimeScale;
    $('gameScale').value=screen().runtimeScale?.percent||100;
    renderScreens(); renderTree(); renderInspector(); renderStage(); positionViewport(); updateHistory();
  }

  function section(title, parent = $('properties')) { const el = make('section', 'prop-section'); el.append(make('h3', '', title)); const grid = make('div', 'prop-grid'); el.append(grid); parent.append(el); return grid; }
  function field(parent, label, key, type = 'number', options = {}) {
    const wrap = make('label', 'prop-field' + (options.wide ? ' wide' : '') + (type === 'checkbox' ? ' check-field' : ''));
    let input;
    if (type === 'select') {
      input = make('select'); (options.choices || []).forEach(item => { const pair = Array.isArray(item) ? item : [item, item]; const opt = make('option', '', pair[1]); opt.value = pair[0]; input.append(opt); });
    } else if (type === 'textarea') input = make('textarea');
    else { input = make('input'); input.type = type; }
    input.dataset.prop = key; input.setAttribute('aria-label', label); input.id = 'prop-' + key;
    const first = picked()[0], val = first?.[key] ?? (key in data.theme ? data.theme[key] : '');
    if (type === 'checkbox') input.checked = !!val; else input.value = val;
    if (type === 'number') {
      const limits = M.numeric[key]; if (limits) { input.min = limits[0]; input.max = limits[1]; }
      input.step = ['opacity', 'fillOpacity', 'frameOpacity', 'value'].includes(key) ? .05 : key === 'lineHeight' ? .05 : 1;
    }
    if (options.disabled) input.disabled = true;
    const text = make('span', '', label); if (type === 'checkbox') wrap.append(input, text); else wrap.append(text, input);
    if (options.hint) input.title = options.hint;
    input.addEventListener('focus', () => { propertyTransaction = null; });
    input.addEventListener('blur', () => { propertyTransaction = null; });
    input.addEventListener(type === 'checkbox' || type === 'select' ? 'change' : 'input', () => {
      if (propertyTransaction !== key) { checkpoint(); propertyTransaction = key; }
      let value = type === 'checkbox' ? input.checked : M.numeric[key] ? Number(input.value) : input.value;
      if (type === 'number' && (input.value === '' || !Number.isFinite(value))) return;
      if (M.numeric[key]) value = Math.min(M.numeric[key][1], Math.max(M.numeric[key][0], value));
      if (key === 'columns') value = Math.floor(value);
      if (key === 'parent') {
        const item = picked()[0]; if (!item || item.id === screen().root || M.descendants(screen(), item.id).has(value)) return;
        const box = boxes.get(item.id); item.parent = value; item.anchor = 'top-left'; M.setWorldPosition(item, box.x, box.y, boxes, viewport);
      } else if (key === 'anchor') {
        for (const item of topPicked()) { const box = boxes.get(item.id); item.anchor = value; M.setWorldPosition(item, box.x, box.y, boxes, viewport); }
      } else if (key === 'fullscreen') screen().fullscreen = value;
      else applyPicked(key,value);
      requestStage(); if (['name', 'parent', 'visible', 'locked'].includes(key)) renderTree(); save();
    });
    parent.append(wrap); return input;
  }
  function colorField(parent, label, key) {
    const first = picked()[0], wrap = make('div', 'prop-field'); wrap.append(make('span', '', label));
    const row = make('div', 'color-field'), input = make('input'), hex = make('input'); input.type = 'color'; input.value = first[key] || data.theme[key]; input.dataset.prop = key; input.setAttribute('aria-label', label);
    hex.type = 'text'; hex.value = input.value; hex.maxLength = 7; hex.setAttribute('aria-label', label + ' HEX');
    const inherit = make('button', 'inherit', '↥'); inherit.title = 'Цвет общей темы';
    function apply(value) { if (!M.colorOK(value)) return; applyPicked(key,value); input.value = value; hex.value = value; requestStage(); save(); }
    for (const el of [input, hex]) { el.addEventListener('focus', checkpoint); el.addEventListener('input', () => apply(el.value)); }
    inherit.addEventListener('click', () => { checkpoint(); for (const item of picked()) delete item[key]; renderInspector(); renderStage(); save(); }); row.append(input, hex, inherit); wrap.append(row); parent.append(wrap);
  }
  function buttonIn(parent, title, action, className) { const button = make('button', className || '', title); button.type = 'button'; button.addEventListener('click', action); parent.append(button); return button; }
  function renderInspector() {
    const area = $('properties'); area.replaceChildren(); const items = picked(), first = items[0];
    $('inspectorName').textContent = items.length > 1 ? items.length + ' элементов' : first?.name || 'Свойства';
    $('resetNode').disabled = !first;
    if (!first) { area.append(make('p', 'empty-state', 'Выбери элемент на макете или в списке слоёв.')); return; }
    let grid = section('Элемент');
    field(grid, 'Название', 'name', 'text', {wide: true});
    field(grid, 'Тип', 'kind', 'select', {choices: Object.entries(kindNames)});
    field(grid, 'Слой Z', 'z');
    field(grid, 'Показывать', 'visible', 'checkbox'); field(grid, 'Заблокирован', 'locked', 'checkbox');
    if (first.id === screen().root) field(grid, 'На весь игровой экран', 'fullscreen', 'checkbox', {wide: true}).checked = screen().fullscreen;
    else if (items.length === 1) {
      const forbidden = M.descendants(screen(), first.id);
      field(grid, 'Внутри группы', 'parent', 'select', {wide: true, choices: screen().nodes.filter(n => !forbidden.has(n.id)).map(n => [n.id, n.name])});
    }
    grid = section('Положение и размер');
    for (const [key, name] of [['x', 'X / отступ'], ['y', 'Y / отступ'], ['w', 'Ширина'], ['h', 'Высота']]) field(grid, name, key);
    field(grid, 'Привязка к родителю', 'anchor', 'select', {wide: true, choices: Object.entries(anchorNames), hint: 'При смене привязки положение сохраняется. X и Y становятся смещением от выбранного края.'});
    const align = make('div', 'align-tools wide'); grid.append(align);
    for (const [key, label] of [['left', 'Слева'], ['hcenter', 'Центр X'], ['right', 'Справа'], ['top', 'Сверху'], ['vcenter', 'Центр Y'], ['bottom', 'Снизу']]) buttonIn(align, label, () => alignSelection(key));
    if (items.length > 1) { const actions = make('div', 'inspector-actions wide'); grid.append(actions); buttonIn(actions, 'Равные зазоры X', () => distribute('x')); buttonIn(actions, 'Равные зазоры Y', () => distribute('y')); buttonIn(actions, 'Один размер', matchSize); buttonIn(actions, 'В группу', groupSelection); }
    buttonIn(grid, 'Масштабировать с содержимым…', scaleSelection, 'wide');
    grid=section('Связанные блоки');
    field(grid,'Выбирать целиком','selectAsBlock','checkbox',{wide:true});
    field(grid,'При изменении размера','resizeMode','select',{wide:true,choices:[['scale','Масштабировать всё содержимое'],['layout','Изменять только панель']]});
    field(grid,'Родитель растёт с содержимым','autoSize','select',{wide:true,choices:[['grow','Да, увеличивать при необходимости'],['none','Фиксированный размер']]});
    field(grid,'Общий шаблон','templateKey','text',{wide:true,hint:'Одинаковое имя связывает размеры и оформление блоков этого экрана. Тексты и картинки остаются индивидуальными.'});
    field(grid,'Роль внутри шаблона','partKey','text',{wide:true});
    const owner=M.blockRoot(screen(),first.id), peers=M.linkedNodes(screen(),first.id);
    const info=make('p','sidebar-note wide',peers.length>1?'Связано экземпляров: '+peers.length+'. Размеры и оформление общие.':'Перемещение блока переносит всех его детей. Ctrl + клик выбирает отдельную деталь.');grid.append(info);
    if(owner&&owner.id!==first.id)buttonIn(grid,'Выбрать блок «'+owner.name+'»',()=>select(owner.id),'wide');
    if(first.parent)buttonIn(grid,'Выбрать родительскую панель',()=>select(first.parent),'wide');
    if(M.blockRoot(screen(),first.id,n=>!!n.templateKey))buttonIn(grid,'Отвязать этот экземпляр',()=>{checkpoint();const root=M.blockRoot(screen(),first.id,n=>!!n.templateKey);root.templateKey='';refresh();save();},'wide');
    grid = section('Компоновка / зазоры');
    field(grid, 'Расположение детей', 'layout', 'select', {wide: true, choices: [['free', 'Свободное'], ['row', 'В ряд'], ['column', 'В колонку'], ['grid', 'Сетка']]});
    field(grid, 'Зазор, px', 'gap'); field(grid, 'Колонок', 'columns'); field(grid, 'Внутренний отступ', 'padding'); field(grid, 'Обрезать детей', 'clipChildren', 'checkbox');
    if (first.layout !== 'free') buttonIn(grid, 'Зафиксировать как свободное', () => { checkpoint(); M.detachFlow(screen(), first.id, boxes); refresh(); save(); }, 'wide');
    grid = section('Рамка и подложка');
    field(grid, 'Вид рамки', 'frame', 'select', {choices: [['ornate', 'NewWorld · латунь'], ['simple', 'Простая линия'], ['bottom', 'Только снизу'], ['none', 'Без рамки']], wide: true});
    field(grid, 'Толщина рамки', 'frameWidth'); field(grid, 'Скругление', 'radius');
    field(grid, 'Рамка: непрозр. 0–1', 'frameOpacity'); field(grid, 'Фон: непрозр. 0–1', 'fillOpacity');
    colorField(grid, 'Цвет рамки / тон', 'frameColor'); colorField(grid, 'Цвет подложки', 'fillColor');
    field(grid, 'Общая непрозрачность 0–1', 'opacity', 'number', {wide: true});
    if (first.frame === 'ornate') grid.append(make('span', 'muted wide', 'Латунь — игровая текстура. Цвет применяется к простой и нижней рамке.'));
    grid = section('Текст и шрифт');
    field(grid, 'Текст примера', 'text', 'textarea', {wide: true});
    const font = field(grid, 'Шрифт (пусто = общая тема)', 'font', 'text', {wide: true}); font.setAttribute('list', 'fontList');
    if (!$('fontList')) { const list = make('datalist'); list.id = 'fontList'; ['Segoe UI', 'Bahnschrift', 'Consolas', 'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'].forEach(f => { const opt = make('option'); opt.value = f; list.append(opt); }); document.body.append(list); }
    field(grid, 'Размер, px', 'fontSize'); field(grid, 'Насыщенность', 'fontWeight', 'select', {choices: [[400, 'Обычный 400'], [500, 'Средний 500'], [600, 'Полужирный 600'], [700, 'Жирный 700'], [800, 'Очень жирный 800']]});
    field(grid, 'По горизонтали', 'align', 'select', {choices: [['left', 'Слева'], ['center', 'Центр'], ['right', 'Справа']]});
    field(grid, 'По вертикали', 'valign', 'select', {choices: [['top', 'Сверху'], ['center', 'Центр'], ['bottom', 'Снизу']]});
    field(grid, 'Межстрочный', 'lineHeight'); field(grid, 'Межбуквенный, px', 'letterSpacing');
    field(grid, 'Курсив', 'italic', 'checkbox'); field(grid, 'Заглавные буквы', 'uppercase', 'checkbox'); colorField(grid, 'Цвет текста', 'textColor');
    grid = section('Картинка / состояние');
    const art = field(grid, 'Игровой ресурс', 'asset', 'select', {wide: true, choices: [['', 'Без картинки'], ...catalog.assets.map(a => [a.id, a.name])]} );
    art.title = 'Реальные изображения из ресурсов игры';
    field(grid, 'Вписывание картинки', 'imageFit', 'select', {wide: true, choices: [['contain', 'Целиком с пропорциями'], ['cover', 'Заполнить с обрезкой'], ['fill', 'Растянуть']]});
    field(grid, 'Заполнение / флажок 0–1', 'value', 'number', {wide: true});
    field(grid, 'Тип прогресса', 'progressMode', 'select', {wide: true, choices: [['bar', 'Полоска'], ['radial', 'Циферблат']]}).value = first.progressMode || 'bar';
    const previewLabel = make('label', 'prop-field wide'); previewLabel.append(make('span', '', 'Предпросмотр состояния')); const preview = make('select'); preview.id = 'previewState'; for (const [value, title] of [['normal', 'Обычное'], ['hover', 'Наведение'], ['pressed', 'Нажато'], ['disabled', 'Недоступно']]) { const option = make('option', '', title); option.value = value; preview.append(option); } previewLabel.append(preview); grid.append(previewLabel); preview.addEventListener('change', requestStage);
    grid = section('Игровой шрифт');
    field(grid,'Отрисовка текста','textRenderer','select',{wide:true,choices:[['atlas','Атлас HUD / инвентаря'],['bitmap','Игровой пиксельный'],['browser','Шрифт браузера']]});
    field(grid,'Игровой шрифт','bitmapFont','select',{wide:true,choices:Object.keys(catalog.fonts||{}).filter(k=>k!=='HudAtlas')});
    grid = section('Заметка для переноса'); field(grid, 'Что важно учесть в игре', 'notes', 'textarea', {wide: true});
    const source = make('div', 'prop-source wide', first.source || 'Пользовательский элемент'); grid.append(source);
    const actions = make('div', 'inspector-actions wide'); grid.append(actions);
    buttonIn(actions, 'Копия', duplicateSelection); buttonIn(actions, 'Удалить', deleteSelection); buttonIn(actions, 'Сброс экрана…', () => $('resetDialog').showModal());
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    let id, mode = event.target.dataset.handle;
    if (mode) id = selected[0];
    else { const target = event.target.closest('.element'); if (!target) { selected = []; renderInspector(); renderTree(); renderOverlay(); return; } id = target.dataset.id; if(!event.ctrlKey&&!event.metaKey)id=M.blockRoot(screen(),id)?.id||id; if (event.altKey && node(id).parent) id = node(id).parent; }
    const target = node(id); if (!target) return;
    if (!mode && (!selected.includes(id) || event.shiftKey)) select(id, event.shiftKey);
    if ((!mode && event.shiftKey) || target.locked || (target.id === screen().root && screen().fullscreen)) return;
    const movable = topPicked().filter(n => !n.locked && !(n.id === screen().root && screen().fullscreen)); if (!movable.length) return;
    event.preventDefault(); $('stageScroll').focus({preventScroll: true});
    drag = {mode: mode || 'move', startX: event.clientX, startY: event.clientY, nodes: movable.map(n => ({id: n.id, before: M.clone(n), box: {...boxes.get(n.id)}})), initial:M.clone(screen().nodes), started: false, pointer: event.pointerId};
    $('stageScroll').setPointerCapture(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    let dx = (event.clientX - drag.startX) / zoom, dy = (event.clientY - drag.startY) / zoom;
    if (!drag.started && Math.abs(dx) + Math.abs(dy) < 2) return;
    if (!drag.started) { checkpoint(); drag.started = true; for (const item of drag.nodes) M.detachFlow(screen(), node(item.id).parent, boxes); }
    const step = $('snap').checked && !event.altKey ? Math.max(1, Number($('gridStep').value) || 8) : 1;
    dx = Math.round(dx / step) * step; dy = Math.round(dy / step) * step;
    screen().nodes=M.clone(drag.initial);
    for (const item of drag.nodes) M.detachFlow(screen(),node(item.id).parent,boxes);
    for (const item of drag.nodes) {
      const n = node(item.id), box = item.box; let x = box.x, y = box.y;
      const scale=box.renderScale||1, lx=dx/scale, ly=dy/scale;
      if (drag.mode === 'move') { x += dx; y += dy; }
      else {
        let w = item.before.w, h = item.before.h;
        if (drag.mode.includes('e')) w = Math.max(1, Math.min(12000, w + lx));
        if (drag.mode.includes('s')) h = Math.max(1, Math.min(12000, h + ly));
        if (drag.mode.includes('w')) { w = Math.max(1, Math.min(12000, w - lx)); x += (item.before.w - w)*scale; }
        if (drag.mode.includes('n')) { h = Math.max(1, Math.min(12000, h - ly)); y += (item.before.h - h)*scale; }
        if (event.shiftKey) { h = Math.max(1, Math.round(w * item.before.h / item.before.w)); }
        M.resizeNode(screen(),n.id,Math.round(w),Math.round(h),linked());
      }
      if(drag.mode==='move'||!n.scaleOwner)M.setWorldPosition(n, x, y, boxes, viewport);
      if(drag.mode==='move'&&n.partKey) {M.applyProperty(screen(),n.id,'x',n.x,linked());M.applyProperty(screen(),n.id,'y',n.y,linked());}
    }
    requestStage();
  }
  function endDrag(event) { if (!drag || event.pointerId !== drag.pointer) return; if (drag.started) { renderStage(); renderInspector(); renderTree(); save(); } drag = null; if ($('stageScroll').hasPointerCapture(event.pointerId)) $('stageScroll').releasePointerCapture(event.pointerId); }
  $('scene').addEventListener('pointerdown', startDrag); $('selectionOverlay').addEventListener('pointerdown', startDrag);
  $('stageScroll').addEventListener('pointermove', dragMove); $('stageScroll').addEventListener('pointerup', endDrag); $('stageScroll').addEventListener('pointercancel', endDrag);
  function alignSelection(direction) {
    const items = topPicked().filter(n => !n.locked && n.parent !== null); if (!items.length) return; checkpoint();
    const group = items.length > 1 ? {x: Math.min(...items.map(n => boxes.get(n.id).x)), y: Math.min(...items.map(n => boxes.get(n.id).y)), right: Math.max(...items.map(n => boxes.get(n.id).x + boxes.get(n.id).w)), bottom: Math.max(...items.map(n => boxes.get(n.id).y + boxes.get(n.id).h))} : null;
    for (const n of items) {
      M.detachFlow(screen(), n.parent, boxes); const b = boxes.get(n.id), parent = boxes.get(n.parent), target = group || {x: parent.x, y: parent.y, right: parent.x + parent.w, bottom: parent.y + parent.h};
      let x = b.x, y = b.y;
      if (direction === 'left') x = target.x; if (direction === 'right') x = target.right - b.w; if (direction === 'hcenter') x = (target.x + target.right - b.w) / 2;
      if (direction === 'top') y = target.y; if (direction === 'bottom') y = target.bottom - b.h; if (direction === 'vcenter') y = (target.y + target.bottom - b.h) / 2;
      M.setWorldPosition(n, x, y, boxes, viewport);
    }
    refresh(); save();
  }
  function distribute(axis) {
    const items = topPicked().filter(n => !n.locked && n.parent !== null).sort((a, b) => boxes.get(a.id)[axis] - boxes.get(b.id)[axis]);
    if (items.length < 3) { toast('Для равных зазоров выбери хотя бы три элемента.'); return; }
    checkpoint(); const size = axis === 'x' ? 'w' : 'h', start = boxes.get(items[0].id)[axis], last = boxes.get(items.at(-1).id), end = last[axis] + last[size];
    const gap = (end - start - items.reduce((total, n) => total + boxes.get(n.id)[size], 0)) / (items.length - 1); let offset = start;
    for (const n of items) { M.detachFlow(screen(), n.parent, boxes); const b = boxes.get(n.id); M.setWorldPosition(n, axis === 'x' ? offset : b.x, axis === 'y' ? offset : b.y, boxes, viewport); offset += b[size] + gap; }
    refresh(); save();
  }
  function matchSize() { const items = topPicked(); if (items.length < 2) return; checkpoint(); for (const n of items.slice(1)) M.resizeNode(screen(),n.id,items[0].w,items[0].h,linked()); refresh(); save(); }
  function scaleSelection() {
    const raw = prompt('Масштаб выбранных элементов с содержимым, % (25–300)', '100'); if (raw === null) return;
    const ratio = Number(raw.replace(',', '.')) / 100; if (!Number.isFinite(ratio) || ratio < .25 || ratio > 3) { toast('Укажи масштаб от 25 до 300%.'); return; }
    checkpoint(); const done=new Set();for(const n of topPicked()) {if(done.has(n.id))continue;M.resizeNode(screen(),n.id,n.w*ratio,n.h*ratio,linked());if(linked())M.linkedNodes(screen(),n.id).forEach(peer=>done.add(peer.id));}
    refresh(); if (autoFit) fit(); save();
  }
  function uniqueId(prefix) { let id; do { id = prefix + '-' + Math.random().toString(36).slice(2, 8); } while (node(id)); return id; }
  function groupSelection() {
    const items = topPicked().filter(n => n.parent !== null); if (items.length < 2) return;
    if (items.some(n => n.parent !== items[0].parent)) { toast('Для объединения выбери элементы одного родителя.'); return; }
    checkpoint(); M.detachFlow(screen(), items[0].parent, boxes);
    const x = Math.min(...items.map(n => boxes.get(n.id).x)), y = Math.min(...items.map(n => boxes.get(n.id).y));
    const scale = boxes.get(items[0].id).renderScale || 1;
    const w = Math.max(...items.map(n => boxes.get(n.id).x + boxes.get(n.id).w)) - x, h = Math.max(...items.map(n => boxes.get(n.id).y + boxes.get(n.id).h)) - y;
    const group = M.blankNode(uniqueId('group'), 'group', items[0].parent, 'Новая группа'); group.w = w / scale; group.h = h / scale; group.selectAsBlock=true; M.setWorldPosition(group, x, y, boxes, viewport);
    screen().nodes.push(group);
    for (const n of items) { const b = boxes.get(n.id); n.parent = group.id; n.anchor = 'top-left'; n.x = (b.x - x) / scale; n.y = (b.y - y) / scale; }
    selected = [group.id]; refresh(); save();
  }
  function duplicateSelection() {
    const items = topPicked().filter(n => n.id !== screen().root); if (!items.length) { toast('Выбери элемент внутри экрана.'); return; }
    checkpoint(); const roots = [];
    for (const item of items) {
      const family = M.descendants(screen(), item.id), copies = screen().nodes.filter(n => family.has(n.id)).map(M.clone), ids = new Map(copies.map(n => [n.id, uniqueId(n.id.slice(0, 70))]));
      for (const copy of copies) {
        const old = copy.id; copy.id = ids.get(old); copy.parent = ids.get(copy.parent) || copy.parent;
        if (old === item.id) { copy.x += 16; copy.y += 16; copy.name += ' · копия'; roots.push(copy.id); }
        copy.source = 'custom/' + copy.id; screen().nodes.push(copy);
      }
    }
    selected = roots; refresh(); save();
  }
  function deleteSelection() {
    const targets = topPicked().filter(n => n.id !== screen().root && !n.locked); if (!targets.length) return; checkpoint(); const remove = new Set();
    targets.forEach(n => M.descendants(screen(), n.id).forEach(id => remove.add(id))); screen().nodes = screen().nodes.filter(n => !remove.has(n.id)); selected = [screen().root]; refresh(); save();
  }
  function resetNodes() {
    const base = catalog.screens.find(s => s.id === currentId); checkpoint();
    for (const item of picked()) { const original = base.nodes.find(n => n.id === item.id); if (original) {
      const parent = item.parent; Object.keys(item).forEach(k => delete item[k]); Object.assign(item, M.clone(original));
      if (item.parent && !node(item.parent)) item.parent = parent;
    } }
    refresh(); save();
  }
  function addNodeDialog() {
    const select = $('newParent'); select.replaceChildren(); screen().nodes.forEach(n => { const option = make('option', '', n.name); option.value = n.id; select.append(option); }); select.value = selected[0] || screen().root; $('addDialog').showModal();
  }
  $('addForm').addEventListener('submit', event => {
    event.preventDefault(); const fields = new FormData(event.target); checkpoint(); const kind = fields.get('kind'), n = M.blankNode(uniqueId(kind), kind, fields.get('parent'), fields.get('name')); n.fontSize = data.theme.fontSize; screen().nodes.push(n); selected = [n.id]; $('addDialog').close(); refresh(); showTab('layers'); save();
  });
  function openTheme() {
    const container = $('themeFields'); container.replaceChildren();
    for (const [key, label, type] of [['font', 'Шрифт', 'text'], ['fontSize', 'Размер новых текстов', 'number'], ['textColor', 'Текст', 'color'], ['fillColor', 'Подложка', 'color'], ['frameColor', 'Рамка', 'color']]) {
      const wrap = make('label', '', label), input = make('input'); input.type = type; input.value = data.theme[key]; if (type === 'number') { input.min = 2; input.max = 256; }
      input.addEventListener('focus', checkpoint); input.addEventListener('input', () => { const value = type === 'number' ? Number(input.value) : input.value; if (type === 'number' && (!value || value < 2 || value > 256)) return; data.theme[key] = value; requestStage(); save(); }); wrap.append(input); container.append(wrap);
    }
    $('themeDialog').showModal();
  }
  $('applyFonts').addEventListener('click', () => { checkpoint(); for (const s of data.screens) for (const n of s.nodes) delete n.font; renderStage(); save(); toast('Шрифт общей темы применён ко всем экранам. Размеры текстов сохранены.'); });
  $('themeDialog').addEventListener('close', renderInspector);
  function download() {
    try { const output = payload(), url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], {type: 'application/json'})), a = make('a'); a.href = url; a.download = 'newworld-interface-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); save(); toast('Макет скачан. Передай этот JSON для переноса в игру.'); }
    catch (error) { toast(error.message); }
  }
  $('fileInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 16 * 1024 * 1024) throw Error('Файл больше 16 МБ.'); const imported = M.validate(JSON.parse(await file.text()), catalog); checkpoint(); data = imported; currentId = data.editorView.screen; viewport = {w: data.editorView.width, h: data.editorView.height}; selected = [screen().root]; refresh(); updateResolution(); fit(); save(); toast('Макет импортирован. Все экраны восстановлены.'); }
    catch (error) { toast('Импорт отменён: ' + error.message); } event.target.value = '';
  });
  $('linkFile').addEventListener('click', async () => {
    if (linkedHandle) { await fileQueue; linkedHandle = null; $('linkFile').textContent = 'Связать JSON'; $('saveStatus').textContent = 'Сохранено в браузере'; toast('Автозапись в файл отключена.'); return; }
    if (!window.showSaveFilePicker) { toast('Связь с файлом доступна в Chrome / Edge. Используй «Скачать макет».'); return; }
    try { linkedHandle = await showSaveFilePicker({suggestedName: 'newworld-interface-layout.json', types: [{description: 'Макет NewWorld', accept: {'application/json': ['.json']}}]}); $('linkFile').textContent = 'Отвязать JSON'; save(); toast('Автозапись включена: ' + linkedHandle.name); }
    catch (error) { if (error.name !== 'AbortError') toast('Файл не подключён: ' + error.message); }
  });
  function updateResolution() { const val = viewport.w + ',' + viewport.h; $('resolution').value = [...$('resolution').options].some(o => o.value === val) ? val : 'custom'; }
  $('resolution').addEventListener('change', () => {
    if ($('resolution').value === 'custom') { const text = prompt('Размер игрового экрана, например 1920x1080', viewport.w + 'x' + viewport.h); const match = text && text.match(/^(\d{3,4})\s*[xх×, ]\s*(\d{3,4})$/i); if (!match) { updateResolution(); return; } viewport = {w: Math.max(640, Math.min(6000, Number(match[1]))), h: Math.max(480, Math.min(4000, Number(match[2])))}; }
    else { const [w, h] = $('resolution').value.split(',').map(Number); viewport = {w, h}; }
    renderStage(); fit(); save();
  });
  $('gameScale').addEventListener('change',()=>{if(!screen().runtimeScale)return;checkpoint();screen().runtimeScale.percent=Math.max(20,Math.min(150,Number($('gameScale').value)||100));refresh();if(autoFit)fit();save();});
  document.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    const control = event.ctrlKey || event.metaKey;
    if (control && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? redoStack : undoStack, event.shiftKey ? undoStack : redoStack); }
    else if (control && event.key.toLowerCase() === 'y') { event.preventDefault(); travel(redoStack, undoStack); }
    else if (control && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); }
    else if (control && event.key.toLowerCase() === 's') { event.preventDefault(); download(); }
    else if (control && event.key.toLowerCase() === 'a') { event.preventDefault(); selected = screen().nodes.filter(n => n.parent !== null).map(n => n.id); renderTree(); renderInspector(); renderOverlay(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
    else if (event.key === 'Escape') { selected = []; renderOverlay(); renderInspector(); renderTree(); }
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault(); const amount = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0, dy = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
      const items = topPicked().filter(n => !n.locked && !(n.id === screen().root && screen().fullscreen)); if (!items.length) return; checkpoint();
      for (const n of items) { M.detachFlow(screen(), n.parent, boxes); const b = boxes.get(n.id); M.setWorldPosition(n, b.x + dx, b.y + dy, boxes, viewport); } renderStage(); renderInspector(); save();
    }
  });
  $('stageScroll').addEventListener('wheel', event => { if (event.ctrlKey) { event.preventDefault(); setZoom(zoom * (event.deltaY < 0 ? 1.1 : .9)); } }, {passive: false});
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  $('screenSearch').addEventListener('input', renderScreens);
  $('undo').addEventListener('click', () => travel(undoStack, redoStack)); $('redo').addEventListener('click', () => travel(redoStack, undoStack));
  $('export').addEventListener('click', download); $('import').addEventListener('click', () => $('fileInput').click());
  $('help').addEventListener('click', () => $('helpDialog').showModal()); $('themeButton').addEventListener('click', openTheme);
  $('resetNode').addEventListener('click', resetNodes); $('addNode').addEventListener('click', addNodeDialog); $('duplicate').addEventListener('click', duplicateSelection); $('delete').addEventListener('click', deleteSelection);
  $('resetDialog').addEventListener('close', () => { if ($('resetDialog').returnValue !== 'reset') return; checkpoint(); const index = data.screens.findIndex(s => s.id === currentId); data.screens[index] = M.clone(catalog.screens.find(s => s.id === currentId)); selected = [screen().root]; refresh(); save(); });
  $('background').addEventListener('change', renderStage); $('grid').addEventListener('change', renderStage); $('gridStep').addEventListener('input', renderStage);
  $('zoomIn').addEventListener('click', () => setZoom(zoom * 1.2)); $('zoomOut').addEventListener('click', () => setZoom(zoom / 1.2)); $('fit').addEventListener('click', fit);
  const observer = new ResizeObserver(() => { if (autoFit) fit(); else positionViewport(); }); observer.observe($('stageScroll'));
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORAGE, JSON.stringify(payload())); } catch (_) { /* Ошибка уже отображается в строке состояния. */ } });
  updateResolution(); refresh(); requestAnimationFrame(fit);
})();
