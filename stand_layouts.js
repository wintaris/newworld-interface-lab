/* Макеты для согласования в стенде. Исходный игровой каталог не изменяем. */
(function (catalog) {
  'use strict';
  const inventory = catalog.screens.find(s => s.id === 'Inventory');
  const nodes = new Map(inventory.nodes.map(n => [n.id, n]));
  const put = (id, properties) => Object.assign(nodes.get(id), properties);

  inventory.previewRevision = 'inventory-compact-1';
  inventory.style = 'preview';
  inventory.note = 'Стенд: компоновка по референсу, свободные ячейки и единый шрифт предметов. Изменения подготовлены для просмотра.';
  Object.assign(inventory.runtimeScale, {widthLimit: 766, heightLimit: 848});
  put('root', {w: 766, h: 848});
  put('Columns', {w: 766, h: 848, gap: 12});
  put('LeftColumn', {w: 332, h: 848});
  put('PortraitPanel', {x: 0, y: 0, w: 270, h: 240});
  put('Description', {x: 0, y: 252, w: 332, h: 430});
  put('BagPanel', {x: 344, y: 0, w: 180, h: 848});
  put('InvItems', {x: 12, y: 12, w: 156, h: 824, gap: 8});
  put('EquipmentColumn', {x: 536, y: 0, w: 230, h: 758, gap: 12});

  // Счётчик, изображение и износ занимают отдельные строки внутри ячейки.
  function item(id, width, height) {
    put(id, {w: width, h: height});
    put(id + '-image', {x: 8, y: 24, w: width - 16, h: height - 50});
    put(id + '-ammo', {x: 4, y: 0, w: width - 8, h: 22, fontSize: 20});
    put(id + '-wear', {x: 4, y: height - 22, w: width - 8, h: 22, fontSize: 20});
  }
  for (let i = 0; i < 8; i++) {
    put('BagItem-' + i, {x: 0, y: i * 102});
    item('BagItem-' + i, 156, 94);
  }
  for (const [panel, slot, height] of [
    ['HandPanel1', 'SlotHand1', 156],
    ['HandPanel2', 'SlotHand2', 146],
    ['ArmorPanel', 'SlotArmor', 136]
  ]) {
    put(panel, {w: 230, h: height});
    put(slot, {x: 10, y: 10});
    item(slot, 210, height - 20);
  }
  put('ExtraRow', {w: 230, h: 124, gap: 8});
  for (const id of ['ExtraSlot1', 'ExtraSlot2']) {
    put(id, {w: 111, h: 124});
    put(id + '-label', {x: 10, y: 44, w: 91, h: 32, fontSize: 20});
  }
  put('Close', {w: 230, h: 76});
  put('Close-label', {x: 12, y: 22, w: 206, h: 32, fontSize: 22});
  put('DropAll', {w: 230, h: 60});
  put('DropAll-label', {x: 10, y: 16, w: 210, h: 28, fontSize: 20});

  put('HP', {y: 48});
  for (let i = 0; i < 7; i++) {
    for (const part of ['SpecialName-', 'SpecialValue-', 'DefenseName-', 'DefenseValue-'])
      put(part + i, {y: 85 + i * 22, h: 22});
  }
  [244, 266, 288, 310, 332, 354].forEach((y, i) => put('WeaponSummary-' + i, {y}));
  put('Weight', {y: 390});
})(window.INTERFACE_CATALOG);
