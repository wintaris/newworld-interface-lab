/* Проверка переносимого формата, привязок и ошибок импорта без браузера. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./model.js');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'catalog.js'), 'utf8'), context);
const sourceCatalog = JSON.parse(JSON.stringify(context.window.INTERFACE_CATALOG));
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'stand_layouts.js'), 'utf8'), context);
const catalog = JSON.parse(JSON.stringify(context.window.INTERFACE_CATALOG));
const validated = M.validate(catalog, catalog);
assert.equal(validated.screens.length, catalog.screens.length);
assert.equal(validated.coverage.schemeEntries, 32);
let elements = 0;
for (const screen of validated.screens) {
  elements += screen.nodes.length;
  for (const viewport of [{w: 1280, h: 800}, {w: 1920, h: 1080}, {w: 3440, h: 1440}]) {
    const boxes = M.resolve(screen, viewport);
    assert.equal(boxes.size, screen.nodes.length, screen.id + ': все элементы достижимы');
    for (const box of boxes.values()) assert.ok([box.x, box.y, box.w, box.h].every(Number.isFinite));
    const root = boxes.get(screen.root);
    if (screen.fullscreen) assert.deepEqual([root.w, root.h], [viewport.w, viewport.h]);
  }
}
const hud = validated.screens.find(s => s.id === 'Game');
for (const viewport of [{w: 1280, h: 800}, {w: 3440, h: 1440}]) {
  const boxes = M.resolve(hud, viewport);
  assert.equal(boxes.get('ChatPanel').x, 0);
  const core = boxes.get('CorePanel'); assert.equal(core.x + core.w / 2, viewport.w / 2);
  const weapon = boxes.get('MainItemPlate'); assert.equal(weapon.x + weapon.w, viewport.w);
}
const layout = {root: 'root', fullscreen: true, nodes: [M.blankNode('root', 'group', null), M.blankNode('a', 'slot', 'root'), M.blankNode('b', 'slot', 'root'), M.blankNode('c', 'slot', 'root')]};
layout.nodes[0].layout = 'grid'; layout.nodes[0].columns = 2; layout.nodes[0].gap = 10; layout.nodes[0].padding = 5;
let boxes = M.resolve(layout, {w: 1000, h: 800});
assert.equal(boxes.get('a').x, 5); assert.equal(boxes.get('b').x, 195); assert.equal(boxes.get('c').y, 95);
M.detachFlow(layout, 'root', boxes); const free = M.resolve(layout, {w: 1000, h: 800}); assert.deepEqual([...boxes.values()], [...free.values()]);
for (const anchor of M.enums.anchor) {
  const n = layout.nodes[1]; n.anchor = anchor; n.x = 20; n.y = 30; boxes = M.resolve(layout, {w: 1000, h: 800});
  const before = boxes.get('a'); M.setWorldPosition(n, before.x + 25, before.y + 10, boxes, {w: 1000, h: 800});
  const after = M.resolve(layout, {w: 1000, h: 800}).get('a'); assert.equal(after.x, before.x + 25); assert.equal(after.y, before.y + 10);
}
const roundTrip = M.clone(validated), inv = roundTrip.screens.find(s => s.id === 'Inventory');
inv.nodes.find(n => n.id === 'SlotHand1').w = 300;
inv.nodes.push(M.blankNode('custom-one', 'text', 'root', 'Новая подпись'));
const exported = M.exportData(roundTrip, catalog, {screen: 'Inventory', width: 1920, height: 1080});
const imported = M.validate(JSON.parse(JSON.stringify(exported)), catalog);
assert.deepEqual(imported.screens, exported.screens);
assert.ok(exported.changes.some(c => c.id === 'custom-one' && c.added));
assert.ok(exported.changes.some(c => c.id === 'SlotHand1' && c.properties.w === 300));
for (const mutate of [
  d => { d.screens.pop(); },
  d => { d.screens[0].nodes[1].parent = 'missing'; },
  d => { d.screens[0].nodes[1].parent = d.screens[0].nodes[1].id; },
  d => { d.screens[0].nodes[1].w = NaN; },
  d => { d.screens[0].nodes[1].fontWeight = '700'; },
  d => { d.screens[0].nodes[1].asset = 'https://untrusted/image'; },
  d => { d.screens[0].nodes[1].textColor = 'url(x)'; },
  d => { d.screens[0].nodes[1].id = d.screens[0].root; }
]) { const invalid = M.clone(validated); mutate(invalid); assert.throws(() => M.validate(invalid, catalog)); }
for (const asset of catalog.assets) assert.ok(fs.existsSync(path.join(__dirname, asset.url)), asset.url);
assert.ok(catalog.baselineId.startsWith('game-sync-2-'));
assert.ok(validated.screens.every(s=>s.style==='current'||s.id==='Inventory'&&s.style==='preview'));
assert.equal(new Set(catalog.screens.filter(s=>s.sync?.mode==='fogui'||s.source.startsWith('Gui/')).map(s=>s.source)).size,32);
const gameSource=path.join(__dirname,'../..');
const hasGameSource=fs.existsSync(path.join(gameSource,'Scripts/NewWorldHudCompact.fos'));
for(const [screenId,file] of [['Game','NewWorldHudCompact'],['Inventory','NewWorldInventory']]) {
  if(!hasGameSource)continue;
  const script=fs.readFileSync(path.join(gameSource,'Scripts',file+'.fos'),'utf8');
  const sourceGeometry=new Map([...script.matchAll(/Put\(root, "([^"]+)", (\d+), (\d+), (\d+), (\d+)\);/g)].map(m=>[m[1],m.slice(2).map(Number)]));
  const s=sourceCatalog.screens.find(s=>s.id===screenId), local=M.clone(s);delete local.runtimeScale;
  const boxes=M.resolve(local,{w:1920,h:1080}), root=boxes.get(local.root), core=boxes.get('CorePanel');
  for(const id of screenId==='Game'?['Heat','Stamina','ActionPoints','Combat']:['InvItems','SlotHand1','SlotHand2','SlotArmor']) {
    const b=boxes.get(id), origin=core||root;
    assert.deepEqual([b.x-origin.x,b.y-origin.y,b.w,b.h],sourceGeometry.get(id),screenId+'/'+id+': геометрия рабочего скрипта');
  }
}
const linkedInv=M.clone(catalog.screens.find(s=>s.id==='Inventory'));
const oldPic=linkedInv.nodes.find(n=>n.id==='BagItem-0-image'), oldCell=linkedInv.nodes.find(n=>n.id==='BagItem-0');
const initialWidth=oldCell.w, initialImageWidth=oldPic.w;
const contents=linkedInv.nodes.filter(n=>n.partKey==='image'||n.partKey==='ammo').map(n=>[n.id,n.asset,n.text]);
const beforeBoxes=M.resolve(linkedInv,{w:1920,h:1080});
M.resizeNode(linkedInv,oldPic.id,initialImageWidth*1.5,oldPic.h*1.5);
for(const cell of linkedInv.nodes.filter(n=>n.templateKey==='Inventory/BagItem'))assert.equal(cell.w,initialWidth*1.5);
for(const [id,asset,text] of contents) {const n=linkedInv.nodes.find(n=>n.id===id);assert.equal(n.asset,asset);assert.equal(n.text,text);}
const afterBoxes=M.resolve(linkedInv,{w:1920,h:1080});
assert.ok(linkedInv.nodes.find(n=>n.id==='BagPanel').w>180);
assert.ok(linkedInv.nodes.find(n=>n.id==='root').w>766);
assert.ok(afterBoxes.get('EquipmentColumn').x>beforeBoxes.get('EquipmentColumn').x,'соседняя колонка отодвигается');
assert.equal(afterBoxes.get('BagItem-1').y-afterBoxes.get('BagItem-0').y,149,'список перестраивается по высоте шаблона');
M.applyProperty(linkedInv,'BagItem-0-ammo','fontSize',24);
assert.ok(linkedInv.nodes.filter(n=>n.partKey==='ammo'&&n.parent.startsWith('BagItem-')).every(n=>n.fontSize===24));
M.applyProperty(linkedInv,'BagItem-0-ammo','text','99/99');
assert.notEqual(linkedInv.nodes.find(n=>n.id==='BagItem-1-ammo').text,'99/99');
const isolated=M.clone(catalog.screens.find(s=>s.id==='Inventory'));
M.resizeNode(isolated,'BagItem-0',200,100,false);
assert.equal(isolated.nodes.find(n=>n.id==='BagItem-1').w,156,'отключённая связь сохраняет соседей');
const parentMove=M.clone(catalog.screens.find(s=>s.id==='Inventory'));
const p=parentMove.nodes.find(n=>n.id==='Columns');p.x+=23;
const moved=M.resolve(parentMove,{w:1920,h:1080});
assert.equal(moved.get('BagItem-0-image').x,beforeBoxes.get('BagItem-0-image').x+23,'содержимое следует за родителем');
const stale=M.clone(catalog);delete stale.baselineId;assert.throws(()=>M.validate(stale,catalog));
const previewInv=catalog.screens.find(s=>s.id==='Inventory');
const previewBoxes=M.resolve(previewInv,{w:1920,h:1080});
for(let i=0;i<8;i++) {
  const id='BagItem-'+i,cell=previewBoxes.get(id),image=previewBoxes.get(id+'-image'),ammo=previewBoxes.get(id+'-ammo'),wear=previewBoxes.get(id+'-wear');
  assert.ok(ammo.y+ammo.h<=image.y,'патроны выше картинки');
  assert.ok(image.y+image.h<=wear.y,'износ ниже картинки');
  assert.ok(wear.y+wear.h<=cell.y+cell.h,'износ помещается в ячейку');
  if(i<7)assert.equal(previewBoxes.get('BagItem-'+(i+1)).y-cell.y-cell.h,8,'зазор между предметами');
}
const itemLabels=previewInv.nodes.filter(n=>n.partKey==='ammo'||n.partKey==='wear');
assert.ok(itemLabels.every(n=>n.fontSize===20),'один средний размер шрифта предметов и экипировки');
const last=previewBoxes.get('BagItem-7'),list=previewBoxes.get('InvItems');
assert.ok(last.y+last.h<=list.y+list.h,'весь список помещается в окно');
console.log(JSON.stringify({result: 'PASS', screens: validated.screens.length, elements, sourceDefinitions: 32, assets: catalog.assets.length, roundTrip: true, anchors: 9, rejectedInvalidInputs: 9, runtimeGeometry:hasGameSource?'PASS':'SKIPPED (portable copy)', linkedComponents:true, parentGrowth:true, individualContentPreserved:true}));
