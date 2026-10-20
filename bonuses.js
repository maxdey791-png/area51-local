/* Optional extension of the original Area 51 gameplay. No physics changes. */
(() => {
  'use strict';
  const KEY = 'area51.virtual-bonuses.v1';
  const defaults = {start: 0, currency: 'Bs', custom: '', frequency: 55, multipliers: [2, 3, 5, 10]};
  const normalize = value => ({
    start: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(value.start) || 0)),
    currency: ['Bs', 'PHP', 'THB', 'USD', 'RUB', 'custom'].includes(value.currency) ? value.currency : 'Bs',
    custom: String(value.custom || '').slice(0, 12),
    frequency: Math.max(0, Math.min(100, Number(value.frequency) || 0)),
    multipliers: [2, 3, 5, 10].filter(n => Array.isArray(value.multipliers) && value.multipliers.includes(n))
  });
  let settings = {...defaults};
  try { const stored = localStorage.getItem(KEY); if (stored) settings = normalize(JSON.parse(stored)); } catch {}
  let balance = settings.start, activeScene, particles = [], seen = new WeakSet(), items = [];
  const overlay = document.createElement('canvas');
  overlay.id = 'area51-bonuses';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:10;max-width:none;max-height:none';
  document.body.append(overlay);
  const ctx = overlay.getContext('2d');
  const style = document.createElement('style');
  style.textContent = '#bonus-settings{border:1px solid #4bdc9b;border-radius:16px;background:#10241e;color:#eefef4;font:16px system-ui;width:min(420px,85vw);padding:24px;z-index:100}#bonus-settings::backdrop{background:#000a}#bonus-settings label{display:block;margin:14px 0}#bonus-settings input:not([type=checkbox]),#bonus-settings select{display:block;box-sizing:border-box;width:100%;padding:8px;margin-top:5px}#bonus-settings button,#bonus-open{padding:9px 14px;border:0;border-radius:7px;background:#83ffc0;color:#10241e;cursor:pointer}#bonus-open{position:fixed;bottom:12px;right:12px;z-index:20}#bonus-settings fieldset label{display:inline-block;margin:8px}#bonus-status{color:#ffda86}';
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'bonus-settings';
  dialog.innerHTML = `<form><h2>Виртуальные бонусы</h2><p>Только игровые очки. Без ставок и выплат.</p><label>Стартовый баланс<input name="start" type="number" min="0" max="9007199254740991" step="1" required></label><label>Валюта<select name="currency"><option>Bs</option><option>PHP</option><option>THB</option><option>USD</option><option>RUB</option><option value="custom">Свой символ</option></select></label><label>Свой символ<input name="custom" maxlength="12"></label><label>Шанс бонуса на платформе (%)<input name="frequency" type="number" min="0" max="100" required></label><fieldset><legend>Доступные множители баланса</legend>${[2,3,5,10].map(n => `<label><input type="checkbox" name="multiplier" value="${n}"> ×${n}</label>`).join('')}</fieldset><p>Сохранение сбрасывает баланс к стартовому и обновляет бонусы.</p><p id="bonus-status" role="status"></p><button type="submit">Сохранить</button> <button type="button" id="bonus-close">Закрыть</button></form>`;
  document.body.append(dialog);
  const open = document.createElement('button'); open.id = 'bonus-open'; open.textContent = 'Бонусы · F2'; document.body.append(open);
  function show() {
    if (dialog.open) return;
    const f = dialog.querySelector('form');
    for (const k of ['start','currency','custom','frequency']) f.elements[k].value = settings[k];
    f.querySelectorAll('[name=multiplier]').forEach(e => e.checked = settings.multipliers.includes(Number(e.value)));
    dialog.showModal();
  }
  open.onclick = show;
  dialog.querySelector('#bonus-close').onclick = () => dialog.close();
  document.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); e.stopImmediatePropagation(); dialog.open ? dialog.close() : show(); } else if (dialog.open) e.stopPropagation(); }, true);
  dialog.addEventListener('pointerdown', e => e.stopPropagation());
  dialog.querySelector('form').onsubmit = e => {
    e.preventDefault(); const f = e.target;
    const next = normalize({start:f.elements.start.value,currency:f.elements.currency.value,custom:f.elements.custom.value,frequency:f.elements.frequency.value,multipliers:[...f.querySelectorAll('[name=multiplier]:checked')].map(e => Number(e.value))});
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { dialog.querySelector('#bonus-status').textContent = 'Браузер запретил локальное сохранение.'; return; }
    settings = next; balance = settings.start; items = []; particles = []; seen = new WeakSet(); dialog.close();
  };
  const amount = () => `${Math.floor(balance).toLocaleString('ru-RU')} ${settings.currency === 'custom' ? settings.custom : settings.currency}`;
  function label(text, x, y, color, size = 22) {
    ctx.font = `bold ${size}px system-ui`; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#09231e'; ctx.strokeText(text,x,y); ctx.fillStyle = color; ctx.fillText(text,x,y);
  }
  window.installArea51Bonuses = ({Gameplay, GroundItem, engine}) => {
    const initGround = GroundItem.prototype.initGroundItem;
    GroundItem.prototype.initGroundItem = function(...args) {
      seen.delete(this); items = items.filter(item => item.ground !== this);
      return initGround.apply(this,args);
    };
    const original = Gameplay.prototype.update;
    const api = {engine, get balance(){return balance;}, get settings(){return {...settings, multipliers:[...settings.multipliers]};}, get items(){return items;}};
    window.area51Bonuses = api;
    Gameplay.prototype.update = function(...args) {
      if (dialog.open) return;
      original.apply(this,args);
      if (activeScene !== this) { activeScene = this; items = []; particles = []; seen = new WeakSet(); balance = settings.start; }
      const hero = this.all['main-hero'];
      if (!hero || !this.groundLayer) return;
      for (const ground of this.groundLayer.children) {
        if (seen.has(ground)) continue; seen.add(ground);
        if (ground.enemy || ground.groundWidth < 65 || Math.random()*100 >= settings.frequency) continue;
        const pool = [100,500,1000,5000,...settings.multipliers.map(n => -n)];
        items.push({ground, offset:32+Math.random()*(ground.groundWidth-64), value:pool[Math.floor(Math.random()*pool.length)]});
      }
      const canvas = engine.pixiApp?.view || document.querySelector('canvas:not(#area51-bonuses)');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      overlay.style.left = `${rect.left}px`; overlay.style.top = `${rect.top}px`; overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
      if (overlay.width !== canvas.width || overlay.height !== canvas.height) { overlay.width=canvas.width; overlay.height=canvas.height; }
      ctx.clearRect(0,0,overlay.width,overlay.height);
      const h = hero.parent.toGlobal({x:hero.x,y:hero.y});
      const alive = !hero.die && hero.scale.x !== 0;
      items = items.filter(item => {
        const g=item.ground;
        if (g.parent !== this.groundLayer || !this.groundLayer.children.includes(g)) return false;
        const x=g.x+item.offset, surface=g.y+item.offset/g.groundWidth*g.groundYShift;
        const p=g.parent.toGlobal({x,y:surface-25});
        const text=item.value>0?`+${item.value}`:`×${-item.value}`;
        if (alive && Math.abs(hero.x-x)<35 && hero.y>surface-80 && hero.y<surface+18) {
          balance = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(item.value>0?balance+item.value:balance*-item.value));
          particles.push({text,x:p.x,y:p.y,life:45});
          return false;
        }
        ctx.beginPath();ctx.arc(p.x,p.y,24,0,Math.PI*2);ctx.fillStyle=item.value>0?'#ffce43':'#b595ff';ctx.fill();ctx.strokeStyle='#fff5bd';ctx.lineWidth=2;ctx.stroke();
        label(text,p.x,p.y+6,'#fff',17); return true;
      });
      if (alive) label(amount(),h.x,Math.max(28,hero.getBounds().y-16),'#9bffcb');
      particles = particles.filter(p => {ctx.globalAlpha=p.life/45;label(p.text,p.x,p.y,'#fff090',26);ctx.globalAlpha=1;p.y-=1.5;return --p.life>0;});
    };
    // Hide the gameplay overlay when a menu or another scene is active.
    function visibility(){overlay.style.visibility=engine.currentScene===activeScene?'visible':'hidden';requestAnimationFrame(visibility);}visibility();
  };
})();
