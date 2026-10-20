/* Area 51 extension: original scenes, hero physics, animations, assets and sound. */
(() => {
  'use strict';
  const KEY = 'area51.virtual-bonuses.v1';
  const MAX = Number.MAX_SAFE_INTEGER;
  const VALUES = [100, 500, 1000, 5000, -2, -3, -5, -10];
  const PRESETS = {veryRare: 6000, rare: 3600, medium: 2000, frequent: 1000};
  const DEFAULTS = {
    start: 100, target: 50000, currency: 'Bs', custom: '', frequency: 'rare',
    spacing: 3600, bonusSize: 2.5, jumpStrength: 32, noLose: true, enabled: VALUES
  };
  const clamp = (n, min, max, fallback) => Number.isFinite(Number(n))
    ? Math.max(min, Math.min(max, Number(n))) : fallback;
  function normalize(value = {}) {
    return {
      start: Math.floor(clamp(value.start, 0, MAX, DEFAULTS.start)),
      target: Math.floor(clamp(value.target, 1, MAX, DEFAULTS.target)),
      currency: ['Bs', 'PHP', 'THB', 'USD', 'RUB', 'custom'].includes(value.currency) ? value.currency : 'Bs',
      custom: String(value.custom || '').slice(0, 12),
      // Migrate the old percent-based setting to the new sparse default.
      frequency: [...Object.keys(PRESETS), 'custom'].includes(value.frequency) ? value.frequency : 'rare',
      spacing: Math.round(clamp(value.spacing, 400, 50000, DEFAULTS.spacing)),
      bonusSize: clamp(value.bonusSize, 2, 3, DEFAULTS.bonusSize),
      jumpStrength: clamp(value.jumpStrength, 25, 38, DEFAULTS.jumpStrength),
      noLose: value.noLose !== false,
      enabled: Array.isArray(value.enabled) ? VALUES.filter(n => value.enabled.includes(n))
        : VALUES.filter(n => n > 0 || !Array.isArray(value.multipliers) || value.multipliers.includes(-n))
    };
  }
  let settings = normalize(DEFAULTS);
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) settings = normalize(JSON.parse(stored) || {});
  } catch { /* A browser without storage can still play with defaults. */ }
  let balance = settings.start;
  let activeScene, finished = false, restarting = false, nextSpawnX = -Infinity;
  let items = [], particles = [], seen = new WeakSet();
  let engine;
  const textFor = value => value > 0 ? `+${value}` : `×${-value}`;
  const currency = () => settings.currency === 'custom' ? settings.custom : settings.currency;
  const amount = () => `${balance.toLocaleString('ru-RU')} ${currency()}`.trim();

  const style = document.createElement('style');
  style.textContent = `
    #bonus-settings,:is(#bonus-finish,#bonus-death){box-sizing:border-box;border:1px solid #63f1b1;border-radius:22px;
      background:linear-gradient(145deg,#173e32,#081d22);color:#effff6;font:17px system-ui;
      width:min(560px,94vw);max-height:90dvh;overflow:auto;padding:28px;box-shadow:0 20px 90px #000a}
    #bonus-settings::backdrop,:is(#bonus-finish,#bonus-death)::backdrop{background:#03150dd9;backdrop-filter:blur(6px)}
    #bonus-settings h2,:is(#bonus-finish,#bonus-death) h2{margin-top:0}
    #bonus-settings [hidden]{display:none}
    #bonus-settings label{display:block;margin:12px 0}
    #bonus-settings input:not([type=checkbox]),#bonus-settings select{box-sizing:border-box;display:block;
      width:100%;padding:9px;margin-top:5px;border:1px solid #75cba0;border-radius:6px;font:inherit}
    #bonus-settings fieldset{border:1px solid #629c84;border-radius:8px;margin:16px 0}
    #bonus-settings fieldset label{display:inline-block;min-width:90px;margin:8px}
    #bonus-settings button,:is(#bonus-finish,#bonus-death) button,#bonus-open{font:bold 16px system-ui;padding:12px 18px;
      border:0;border-radius:9px;background:#83ffc0;color:#10241e;cursor:pointer}
    #bonus-settings button:focus-visible,:is(#bonus-finish,#bonus-death) button:focus-visible{outline:3px solid #fff}
    #bonus-open{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));right:12px;z-index:20}
    #bonus-status{color:#ffda86}:is(#bonus-finish,#bonus-death){text-align:center}
    :is(#bonus-finish,#bonus-death) .finish-icon{font-size:76px;color:#ffdc6a}
    :is(#bonus-finish,#bonus-death) .finish-balance{font-size:clamp(30px,5vw,52px);font-weight:900;color:#a5ffcd;overflow-wrap:anywhere;margin:24px 0}
    :is(#bonus-finish,#bonus-death) button{margin:6px}:is(#bonus-finish,#bonus-death) small{display:block;margin-top:22px;color:#c0d8cc}
  `;
  document.head.append(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'bonus-settings';
  dialog.innerHTML = `<form>
    <h2>Настройки игры · F2</h2><p>Виртуальные очки · без ставок и выплат</p>
    <label>Начальный баланс<input name="start" type="number" min="0" max="${MAX}" step="1" required></label>
    <label>Целевой баланс<input name="target" type="number" min="1" max="${MAX}" step="1" required></label>
    <label>Валюта<select name="currency">${['Bs','PHP','THB','USD','RUB'].map(s => `<option>${s}</option>`).join('')}<option value="custom">Свой символ</option></select></label>
    <label>Свой символ<input name="custom" maxlength="12"></label>
    <label>Частота появления бонусов<select name="frequency">
      <option value="veryRare">Очень редко</option><option value="rare">Редко</option>
      <option value="medium">Средне</option><option value="frequent">Часто</option>
      <option value="custom">Своя частота</option></select></label>
    <label id="bonus-spacing">Минимальное расстояние между бонусами (единицы мира)
      <input name="spacing" type="number" min="400" max="50000" step="1" required></label>
    <label>Размер бонусов<select name="bonusSize"><option value="2">×2</option><option value="2.5">×2,5</option><option value="3">×3</option></select></label>
    <label>Сила прыжка (25–38)<input name="jumpStrength" type="number" min="25" max="38" step="1" required></label>
    <label>Без проигрыша<select name="noLose"><option value="true">Вкл.</option><option value="false">Выкл.</option></select></label><small>Защита от змей и ловушек. Падение в пропасть завершает забег.</small>
    <fieldset><legend>Доступные бонусы и множители</legend>${VALUES.map(n => `<label><input type="checkbox" name="enabled" value="${n}"> ${textFor(n)}</label>`).join('')}</fieldset>
    <p>Сохранение начинает новый забег с начальным балансом. Множители умножают текущий баланс.</p>
    <p id="bonus-status" role="status"></p>
    <button type="submit">Сохранить и играть</button> <button type="button" id="bonus-close">Закрыть</button>
  </form>`;
  document.body.append(dialog);
  const finishDialog = document.createElement('dialog');
  finishDialog.id = 'bonus-finish';
  finishDialog.innerHTML = `<div class="finish-icon" aria-hidden="true">✦</div><h2>Финиш! Цель достигнута</h2>
    <p>Ваш итоговый баланс</p><div class="finish-balance"></div>
    <button type="button" id="bonus-restart">Играть заново</button>
    <button type="button" id="bonus-configure">Настройки</button>
    <small>Только виртуальные игровые очки. Без реальных ставок и выплат.</small>`;
  document.body.append(finishDialog);
  const deathDialog=document.createElement('dialog');
  deathDialog.id='bonus-death';
  deathDialog.innerHTML='<h2>Game Over</h2><p>Забег завершён</p><div class="finish-balance"></div><button type="button" id="death-restart">Играть заново</button><button type="button" id="death-settings">Настройки</button>';
  document.body.append(deathDialog);
  const openButton = document.createElement('button');
  openButton.id = 'bonus-open'; openButton.textContent = 'Настройки · F2'; document.body.append(openButton);

  function clearInput() {
    if (!engine?.keys) return;
    for (const k of Object.keys(engine.keys.all)) engine.keys.all[k] = false;
    engine.mouse.click = false;
  }
  function focusGame() {
    const canvas=document.querySelector('canvas:not(#area51-bonuses)');
    if(canvas){canvas.tabIndex=0;canvas.focus({preventScroll:true});}
  }
  function restart() {
    clearInput();
    if (finishDialog.open) finishDialog.close();
    if (deathDialog.open) deathDialog.close();
    finished = false; restarting = true; balance = settings.start;
    // The original init may reuse pooled scenes; reset in init, not by identity.
    window.isNotFirstRun = true;
    engine.replaceScene('level/1');
    focusGame();
  }
  function updateSpacingControl() {
    const custom = dialog.querySelector('[name=frequency]').value === 'custom';
    dialog.querySelector('#bonus-spacing').hidden = !custom;
    dialog.querySelector('[name=spacing]').disabled = !custom;
  }
  function showSettings() {
    if (dialog.open) return;
    clearInput();
    if (finishDialog.open) finishDialog.close();
    if (deathDialog.open) deathDialog.close();
    const form = dialog.querySelector('form');
    for (const k of ['start','target','currency','custom','frequency','spacing','bonusSize','jumpStrength','noLose']) form.elements[k].value = String(settings[k]);
    form.querySelectorAll('[name=enabled]').forEach(e => { e.checked = settings.enabled.includes(Number(e.value)); });
    dialog.querySelector('#bonus-status').textContent = '';
    updateSpacingControl(); dialog.showModal();
  }
  function showFinish() {
    if (finishDialog.open || dialog.open) return;
    finishDialog.querySelector('.finish-balance').textContent = amount();
    finishDialog.showModal();
  }
  function showGameOver() {
    if(dialog.open || deathDialog.open || restarting || finished) return;
    clearInput();deathDialog.querySelector('.finish-balance').textContent=amount();deathDialog.showModal();
  }
  deathDialog.querySelector('#death-restart').onclick=restart;
  deathDialog.querySelector('#death-settings').onclick=showSettings;
  deathDialog.addEventListener('cancel',e=>e.preventDefault());
  function complete(scene) {
    if (finished) return;
    finished = true; clearInput();
    const hero = scene.all['main-hero'];
    hero.xSpeed = hero.ySpeed = 0;
    scene.currentXSpeed = scene.currentYSpeed = 0;
    // Updates are frozen; preserve the original current pose without a death animation.
    scene.all.bgMusic?.stop(); showFinish();
  }
  openButton.onclick = showSettings;
  dialog.querySelector('#bonus-close').onclick = () => dialog.close();
  dialog.querySelector('[name=frequency]').onchange = updateSpacingControl;
  dialog.addEventListener('close', () => { if (finished) showFinish(); else if(!restarting && activeScene?.all?.['main-hero']?.die) showGameOver(); else focusGame(); });
  finishDialog.addEventListener('cancel', e => e.preventDefault());
  finishDialog.querySelector('#bonus-restart').onclick = restart;
  finishDialog.querySelector('#bonus-configure').onclick = showSettings;
  document.addEventListener('keydown', e => {
    if (e.key === 'F2') {
      e.preventDefault(); e.stopImmediatePropagation();
      dialog.open ? dialog.close() : showSettings();
    } else if (dialog.open || finishDialog.open || deathDialog.open) {
      // Keep normal typing, dialog navigation and Escape; isolate game listeners.
      e.stopPropagation();
    }
  }, true);
  for (const d of [dialog, finishDialog, deathDialog]) {
    for (const event of ['pointerdown','mousedown','touchstart']) d.addEventListener(event, e => e.stopPropagation());
  }
  dialog.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const form = e.target;
    const value = Object.fromEntries(['start','target','currency','custom','frequency','spacing','bonusSize','jumpStrength','noLose'].map(k => [k, form.elements[k].value]));
    value.noLose = value.noLose === 'true';
    value.enabled = [...form.querySelectorAll('[name=enabled]:checked')].map(e => Number(e.value));
    const next = normalize(value);
    if (next.target <= next.start) {
      dialog.querySelector('#bonus-status').textContent = 'Целевой баланс должен быть больше начального.'; return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch { dialog.querySelector('#bonus-status').textContent = 'Браузер запретил локальное сохранение.'; return; }
    settings = next; finished = false; dialog.close(); restart();
  };

  const overlay = document.createElement('canvas');
  overlay.id = 'area51-bonuses';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:10;max-width:none;max-height:none';
  document.body.append(overlay);
  const ctx = overlay.getContext('2d');
  function label(text, x, y, color, size, maxWidth = 100000) {
    ctx.font = `900 ${size}px system-ui`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(5,size/6); ctx.strokeStyle = '#061c22'; ctx.strokeText(text,x,y,maxWidth);
    ctx.fillStyle = color; ctx.fillText(text,x,y,maxWidth);
  }
  function point(node, x, y) { return node.toGlobal({x,y}); }
  function surfaceFor(item) {
    const ground = item.ground;
    return {x:ground.x+item.offset, y:ground.y+item.offset/ground.groundWidth*ground.groundYShift};
  }
  function reset(scene) {
    activeScene = scene; balance = settings.start; finished = false; restarting = false;
    items = []; particles = []; seen = new WeakSet(); nextSpawnX = -Infinity;
    scene._area51Camera = null; scene._area51FallingDeath=false; scene._area51DeathAt=null;
    if (finishDialog.open) finishDialog.close();
    if (deathDialog.open) deathDialog.close();
  }
  function spawn(scene) {
    const hero = scene.all['main-hero'];
    // Intro floor is scripted and should not receive random collectibles.
    if (!hero.jumpEnabled || !settings.enabled.length) return;
    const distance = scene.currentDistance*90;
    const spacing = PRESETS[settings.frequency] || settings.spacing;
    const radius = 24*settings.bonusSize;
    for (const ground of scene.groundLayer.children) {
      if (seen.has(ground)) continue;
      seen.add(ground);
      if (ground.enemy || !ground.nextPointer || ground.groundWidth < radius*2+4) continue;
      const offset = ground.groundWidth/2;
      const position = ground.x+offset;
      const worldX = distance+position;
      // Only ahead of the hero; reserve a random, guaranteed minimum gap.
      if (position < hero.x+radius+100 || worldX < nextSpawnX) continue;
      items.push({ground,offset,value:settings.enabled[Math.floor(Math.random()*settings.enabled.length)],radius});
      nextSpawnX = worldX+spacing*(1+Math.random()*.6);
    }
  }
  function collect(scene) {
    const hero = scene.all['main-hero'];
    if (hero.die || !hero.scale.x || !hero.jumpEnabled) return;
    // Collision is in the same parent space used by the original ground physics.
    // Hero torso-to-feet capsule, avoiding the wide decorative animation bounds.
    const x = hero.x, top = hero.y-260, bottom = hero.y;
    items = items.filter(item => {
      if (finished) return true;
      const surface = surfaceFor(item);
      const centerY = surface.y-item.radius;
      const dx = Math.max(0, Math.abs(x-surface.x)-32);
      const dy = centerY < top ? top-centerY : centerY > bottom ? centerY-bottom : 0;
      if (dx*dx+dy*dy > item.radius*item.radius) return true;
      balance = Math.min(MAX, item.value>0 ? balance+item.value : balance*-item.value);
      particles.push({text:textFor(item.value),x:surface.x,y:centerY,life:55});
      if (balance >= settings.target) complete(scene);
      return false;
    });
  }
  function draw() {
    const scene = activeScene;
    overlay.style.visibility = scene && engine.currentScene === scene ? 'visible' : 'hidden';
    if (!scene || engine.currentScene !== scene) return;
    const canvas = document.querySelector('canvas:not(#area51-bonuses)');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const resolution = engine.pixiApp?.renderer?.resolution || 1;
    overlay.style.left=`${rect.left}px`; overlay.style.top=`${rect.top}px`;
    overlay.style.width=`${rect.width}px`; overlay.style.height=`${rect.height}px`;
    if (overlay.width!==canvas.width || overlay.height!==canvas.height) { overlay.width=canvas.width; overlay.height=canvas.height; }
    ctx.setTransform(resolution,0,0,resolution,0,0);
    ctx.clearRect(0,0,canvas.width/resolution,canvas.height/resolution);
    const hero=scene.all['main-hero'];
    for (const item of items) {
      const surface=surfaceFor(item), p=point(item.ground.parent,surface.x,surface.y-item.radius);
      const edge=point(item.ground.parent,surface.x+item.radius,surface.y-item.radius);
      const radius=Math.hypot(edge.x-p.x,edge.y-p.y);
      const glow=ctx.createRadialGradient(p.x-radius*.3,p.y-radius*.4,1,p.x,p.y,radius);
      glow.addColorStop(0,item.value>0?'#fff6b1':'#e9deff');glow.addColorStop(1,item.value>0?'#f4ae21':'#9062e9');
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fillStyle=glow;ctx.fill();
      ctx.strokeStyle='#fff2c4';ctx.lineWidth=3;ctx.stroke();
      label(textFor(item.value),p.x,p.y+radius*.21,'#fff',Math.max(34,radius*.7),radius*1.85);
    }
    if (hero?.scale.x && !hero.die) {
      // Fixed local anchor, transformed with the hero and camera. Never use
      // getBounds(): animated limbs/particles change those bounds every frame.
      const anchor=point(hero,0,-350);
      const width=engine.pixiApp.renderer.screen.width;
      const available=Math.max(80,2*Math.min(anchor.x-8,width-anchor.x-8));
      ctx.font='900 46px system-ui';
      const size=Math.max(24,Math.min(46,46*available/ctx.measureText(amount()).width));
      label(amount(),anchor.x,anchor.y,'#afffd3',size,available);
    }
    for (const particle of particles) {
      const p=point(scene.groundLayer,particle.x,particle.y);
      ctx.globalAlpha=particle.life/55;label(particle.text,p.x,p.y,'#fff39a',44);ctx.globalAlpha=1;
    }
  }
  window.installArea51Bonuses = ({Gameplay, GroundItem, RunHero, engine: game}) => {
    engine=game;
    // Use the engine's existing resize/render-resolution system in either orientation.
    Object.assign(window._thingEngineAssets.projectDesc,{
      screenOrientation:'auto',portraitWidth:390,portraitHeight:844,
      dynamicStageSize:true,autoFullscreenMobile:false
    });
    function resize(){
      engine.onResize();
      const scene=engine.currentScene;
      if(scene?._area51Camera) {
        scene._area51Camera.targetZoom=fixedZoom();
        scene._area51Camera.zoom=scene._area51Camera.targetZoom;
        applyZoom(scene);
      }
    }
    window.addEventListener('resize',resize);
    window.visualViewport?.addEventListener('resize',resize);
    function viewport(scene) {
      const camera=scene?._area51Camera;
      const zoom=Math.min(camera?.zoom || 1,camera?.targetZoom || .75);
      const x=camera?.world.x || 0;
      return {left:-x/zoom,right:(engine.W-x)/zoom};
    }
    Object.defineProperty(GroundItem.prototype,'isNeedSpawnNext',{
      configurable:true,get(){
        if(!engine.currentScene?._area51Camera) return this.x+this.nextPosX<engine.W;
        return this.x+this.nextPosX<viewport(engine.currentScene).right+240;
      }
    });
    Object.defineProperty(GroundItem.prototype,'isPassedScreen',{
      configurable:true,get(){
        const scene=engine.currentScene;
        if(!scene?._area51Camera) return this.x<-this.nextPosX;
        return this.x+this.nextPosX<viewport(scene).left-160;
      }
    });
    const originalKill=RunHero.prototype.kill;
    RunHero.prototype.kill=function(falling){
      if(finished || this.die) return;
      if(!falling && settings.noLose) return;
      const scene=engine.currentScene;
      scene._area51FallingDeath=!!falling;
      return originalKill.call(this,falling);
    };
    const originalGameOver=Gameplay.prototype.gameOver;
    Gameplay.prototype.gameOver=function(...args){
      if(settings.noLose && !this._area51FallingDeath) return;
      this._area51DeathAt=performance.now();
      return originalGameOver.apply(this,args);
    };
    const initGround=GroundItem.prototype.initGroundItem;
    GroundItem.prototype.initGroundItem=function(...args) {
      seen.delete(this);items=items.filter(item=>item.ground!==this);
      return initGround.apply(this,args);
    };
    const init=Gameplay.prototype.init, update=Gameplay.prototype.update;
    Gameplay.prototype.init=function(...args) {init.apply(this,args);reset(this);};
    Gameplay.prototype.update=function(...args) {
      if (dialog.open || deathDialog.open || finished || restarting) return;
      update.apply(this,args);
      if (engine.currentScene!==this || !this.all['main-hero']) return;
      items=items.filter(item=>item.ground.parent===this.groundLayer && this.groundLayer.children.includes(item.ground));
      const hero=this.all['main-hero'];
      if (!hero.die) {spawn(this);collect(this);}
      applyZoom(this);
      if(hero.die && this._area51DeathAt!==null && performance.now()-this._area51DeathAt>500) showGameOver();
      particles=particles.filter(p=>{p.y-=1.5;return --p.life>0;});
    };
    function fallLimit(scene) {
      const camera=scene?._area51Camera;
      return (engine.H-(camera?.world.y || 0))/(camera?.zoom || 1)+250;
    }
    function fixedZoom() {
      // Fit the configured maximum jump, once per viewport/settings change.
      // It never depends on the hero's current jump or velocity.
      return clamp(Math.min(engine.W/800,(engine.H*.65-110)/(365+settings.jumpStrength*settings.jumpStrength/3)),.2,.75,.6);
    }
    function applyZoom(scene) {
      const camera=scene._area51Camera;
      if(!camera) return;
      camera.world.scale.set(camera.zoom);
      camera.world.x=Math.min(207,engine.W*.24)-scene.all['main-hero'].x*camera.zoom;
      camera.world.y=engine.H*.65-camera.referenceY*camera.zoom;
    }
    function updateCamera(scene) {
      const hero=scene.all['main-hero'];
      if(!hero?.jumpEnabled) {
        const reference=scene.groundLayer.children[7] || scene.latestGround;
        scene.currentYSpeed=(scene.currentYSpeed+.01*(engine.H/2+160-reference.y))*.8;
        return;
      }
      // Physics remains in level coordinates. Only the parent camera transform moves.
      scene.currentYSpeed=0;
      if(hero.die) return;
      const surface=scene.getGroundY(hero.x);
      const landing=scene.groundLayer.children.find(g=>g.x+g.groundWidth>hero.x && g.groundWidth>0);
      const ground=Number.isFinite(surface)?surface:landing?.y;
      if(!scene._area51Camera) {
        const world=hero.parent;world.stop();
        scene._area51Camera={world,zoom:world.scale.x,targetZoom:fixedZoom(),referenceY:ground || hero.y};
      }
      const camera=scene._area51Camera;
      camera.targetZoom=fixedZoom();
      camera.zoom+=(camera.targetZoom-camera.zoom)*.12;
      if(Number.isFinite(ground)) {
        const error=ground-camera.referenceY;
        const screenError=Math.abs(error*camera.zoom);
        // A terrain-only dead zone: jumping cannot alter this reference.
        if(screenError>engine.H*.025) {
          const factor=screenError>engine.H*.07?.10:.05;
          camera.referenceY+=clamp(error*factor,-6,6,0);
        }
      }
      applyZoom(scene);
    }
    const api={engine,updateCamera,fallLimit,
      get restarting(){return restarting;},get balance(){return balance;},get finished(){return finished;},
      get settings(){return {...settings,enabled:[...settings.enabled]};},
      get items(){return items.map(item=>({...item}));}
    };
    window.area51Bonuses=api;
    // Render after the engine updates transforms, including while a dialog is open.
    function render(){draw();requestAnimationFrame(render);}requestAnimationFrame(render);
  };
})();
