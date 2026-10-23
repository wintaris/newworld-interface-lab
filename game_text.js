/* Игровые атласы и метрики. Браузерные шрифты доступны отдельным режимом. */
(function () {
  'use strict';
  const cache = new Map();
  function load(url, ready) {
    if (!cache.has(url)) { const img = new Image(); img.src = url; cache.set(url, img); }
    const img = cache.get(url);
    if (!img.complete) img.addEventListener('load', ready, {once:true});
    return img;
  }
  function draw(canvas, n, box, catalog, color) {
    const font = catalog.fonts?.[n.textRenderer === 'atlas' ? 'HudAtlas' : n.bitmapFont || 'Default'];
    if (!font) return;
    const asset = catalog.assets.find(a => a.id === font.asset);
    const paint = () => {
      if (!canvas.isConnected) return;
      const img = load(asset.url,paint); if (!img.complete || !img.naturalWidth) return;
      const scale = box.renderScale || 1, w = Math.max(1,Math.ceil(box.w)), h = Math.max(1,Math.ceil(box.h));
      canvas.width = w * 2; canvas.height = h * 2;
      const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.imageSmoothingEnabled=n.textRenderer==='atlas';
      const value=n.uppercase?n.text.toLocaleUpperCase('ru'):n.text;
      if (n.textRenderer==='atlas') {
        const indices=[...value].map(c=>Math.max(0,font.glyphs.indexOf(c))), total=indices.reduce((sum,i)=>sum+font.advances[i],0);
        const ratio=Math.min(Math.min(h,n.fontSize*scale)/font.cap,w/Math.max(1,total));
        const width=total*ratio;
        let x=n.align==='right'?w-width:n.align==='center'?(w-width)/2:0;
        const y=(h-font.cap*ratio)/2-font.top*ratio;
        for(const i of indices) { const sw=img.naturalWidth/font.columns, sh=img.naturalHeight/font.rows;
          ctx.drawImage(img,(i%font.columns)*sw,Math.floor(i/font.columns)*sh,sw,sh,x,y,128*ratio,128*ratio);x+=font.advances[i]*ratio;
        }
      } else {
        const ratio=n.fontSize/font.lineHeight*scale, line=(font.lineHeight+font.gap)*ratio;
        const lines=[];let row='',width=0;
        for (const char of value) {
          const g=font.glyphs[char]||font.glyphs['?'];if(!g)continue;
          const cw=g.advance*ratio;
          if(char==='\n' || width+cw>w && row) { lines.push([row,width]);row='';width=0;if(char==='\n')continue; }
          row+=char;width+=cw;
        }
        if(row)lines.push([row,width]);
        let y=n.valign==='center'?(h-lines.length*line)/2:n.valign==='bottom'?h-lines.length*line:0;
        for(const [text,width] of lines) {
          let x=n.align==='right'?w-width:n.align==='center'?(w-width)/2:0;
          for(const char of text) {const g=font.glyphs[char]||font.glyphs['?'];if(g.w&&g.h)ctx.drawImage(img,g.x,g.y,g.w,g.h,x+g.ox*ratio,y+g.oy*ratio,g.w*ratio,g.h*ratio);x+=g.advance*ratio;}
          y+=line;
        }
      }
      ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,w,h);
      if(n.shadow)canvas.style.filter='drop-shadow(1px 1px 0 #000503)';
    };
    requestAnimationFrame(paint);
  }
  window.GameText={draw};
})();
