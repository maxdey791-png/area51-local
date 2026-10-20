/* Chromium integration: fixed terrain camera, device resize, hazards, falling, victory. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800},isMobile:true,hasTouch:true,
   userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.adinplay.com/**',r=>r.abort());
  await page.goto(process.env.AREA51_TEST_URL||'http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.area51Bonuses?.engine.currentScene);
  await page.mouse.click(640,445);
  await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='main');
  async function configure({enabled=[],target=50000,noLose=true}={}) {
   await page.locator('#bonus-open').click();
   await page.locator('[name=start]').fill('100');await page.locator('[name=target]').fill(String(target));
   await page.locator('[name=jumpStrength]').fill('38');
   await page.locator('[name=noLose]').selectOption(String(noLose));
   for(const box of await page.locator('[name=enabled]').all())await box.setChecked(enabled.includes(Number(await box.getAttribute('value'))));
   await page.locator('[type=submit]').click();
   await page.waitForFunction(()=>!area51Bonuses.restarting && area51Bonuses.engine.currentScene.name==='level/1' && area51Bonuses.engine.currentScene.all['main-hero'].jumpEnabled);
   await page.waitForFunction(()=>{const c=area51Bonuses.engine.currentScene._area51Camera;return area51Bonuses.finished || (c&&Math.abs(c.zoom-c.targetZoom)<.002);});
  }
  async function diagnose(){return page.evaluate(()=>{
   const a=area51Bonuses,e=a.engine,s=e.currentScene,h=s.all['main-hero'],c=s._area51Camera;
   const y=s.getGroundY(h.x),g=s.groundLayer.children.find(g=>g.x+g.groundWidth>h.x);
   const surface=Number.isFinite(y)?y:g?.y;
   const end=s.groundLayer.children.at(-1);
   return {W:e.W,H:e.H,rotation:e.stage.rotation,zoom:c.zoom,target:c.targetZoom,reference:c.referenceY,
    ground:h.parent.toGlobal({x:h.x,y:surface}).y/e.H,air:surface-h.y,
    head:h.getBounds().y,anchor:h.toGlobal({x:0,y:-350}).y,
    ySpeed:s.currentYSpeed,die:h.die,fall:s._area51FallingDeath,balance:a.balance,
    right:end.parent.toGlobal({x:end.x+end.nextPosX,y:end.y}).x,
    canvas:{width:e.pixiApp.view.getBoundingClientRect().width,height:e.pixiApp.view.getBoundingClientRect().height}};
  });}
  await configure();
  // Resize the SAME live game as DevTools does; no reload or source edits.
  for(const [width,height] of [[390,844],[360,800],[1080,1920]]){
   await page.setViewportSize({width,height});
   await page.waitForFunction(([w,h])=>{const r=area51Bonuses.engine.pixiApp.view.getBoundingClientRect();return Math.abs(r.width-w)<3&&Math.abs(r.height-h)<3;},[width,height]);
   await page.waitForFunction(()=>{const c=area51Bonuses.engine.currentScene._area51Camera;return Math.abs(c.zoom-c.targetZoom)<.002;});
   const d=await diagnose();console.log('[camera diagnostic]',width,height,d);
   assert.equal(d.rotation,0,'portrait must not rotate the stage');
   assert(Math.abs(d.canvas.width-width)<3 && Math.abs(d.canvas.height-height)<3,'canvas must fill viewport');
   assert(d.ground>.58&&d.ground<.72,'terrain must stay near 60–70%');assert.equal(d.ySpeed,0);
   assert(d.right>=d.W,'level must cover enlarged viewport');
   await page.locator('#bonus-open').click();
   const panel=await page.locator('#bonus-settings').boundingBox();assert(panel.x>=0&&panel.y>=0&&panel.width<=width&&panel.height<=height);
   await page.locator('#bonus-close').click();
   await page.screenshot({path:`/tmp/area51-mobile-${width}x${height}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  await configure();
  const jumps=[];
  for(let i=0;i<3;i++){
   await page.waitForFunction(()=>{const h=area51Bonuses.engine.currentScene.all['main-hero'];return h.canJump&&!h.die;});
   await page.evaluate(()=>{
    window.probe={started:false,done:false,dead:false,samples:[]};
    function sample(){const a=area51Bonuses,e=a.engine,s=e.currentScene,h=s.all['main-hero'],c=s._area51Camera;
     if(h.ySpeed<-5)probe.started=true;
     if(probe.started){const y=s.getGroundY(h.x),g=s.groundLayer.children.find(g=>g.x+g.groundWidth>h.x);
      const surface=Number.isFinite(y)?y:g?.y;
      probe.samples.push({zoom:c.zoom,ground:h.parent.toGlobal({x:h.x,y:surface}).y/e.H,air:surface-h.y,head:h.getBounds().y});
      if(h.canJump)probe.done=true;}
     probe.dead=h.die;if(!probe.done&&!probe.dead)requestAnimationFrame(sample);
    }requestAnimationFrame(sample);
   });
   await page.keyboard.down('Space');await page.waitForFunction(()=>probe.started||probe.dead);assert(await page.evaluate(()=>probe.started),'jump failed: '+JSON.stringify(await diagnose()));await page.keyboard.up('Space');
   await page.waitForFunction(()=>probe.done||probe.dead);
   const result=await page.evaluate(()=>probe);assert(!result.dead);
   assert(Math.max(...result.samples.map(s=>s.air))>200);
   assert(result.samples.every(s=>s.ground>.58&&s.ground<.72),'jump must not drag ground out of view');
   const zooms=result.samples.map(s=>s.zoom);assert(Math.max(...zooms)-Math.min(...zooms)<.003,'jump must not change zoom');
   assert(result.samples.every(s=>s.head>=0));jumps.push({samples:zooms.length,minGround:Math.min(...result.samples.map(s=>s.ground)),maxGround:Math.max(...result.samples.map(s=>s.ground))});
  }
  console.log('[camera diagnostic] three mobile jumps',jumps);
  // Native prefab, original collision detection and original catch animation.
  await page.evaluate(()=>{
   const a=area51Bonuses,s=a.engine.currentScene,h=s.all['main-hero'];
   const g=s.groundLayer.children.find(g=>g.x>h.x+160&&g.groundWidth>90);
   if(g.enemy)g.enemy.remove();const enemy=a.engine.Lib.loadPrefab('snake');g.addChild(enemy);g.enemy=enemy;
   const p=g.toLocal({x:g.x+50,y:g.y+50/g.groundWidth*g.groundYShift},g.parent);enemy.position.set(p.x,p.y);
   window.catches=0;const original=enemy.gotoLabelRecursive;enemy.gotoLabelRecursive=function(label,...args){if(label==='catch')catches++;return original.call(this,label,...args);};
  });
  await page.waitForFunction(()=>catches>0||area51Bonuses.engine.currentScene.all['main-hero'].die);
  assert.equal((await diagnose()).die,false);assert(await page.evaluate(()=>catches>0));
  console.log('[death diagnostic] snake animation triggered, no death in protected mode');
  // Let original gravity carry the runner into an actual procedurally generated gap.
  await page.waitForFunction(()=>area51Bonuses.engine.currentScene.all['main-hero'].die,{},{timeout:60000});
  const death=await diagnose();console.log('[death diagnostic] natural pit',death);
  assert(death.fall,'protected mode must still permit fall death');
  assert.equal(await page.evaluate(()=>area51Bonuses.engine.currentScene.currentXSpeed),0);
  await page.locator('#bonus-death').waitFor({state:'visible'});
  await page.locator('#death-restart').click();assert.equal(await page.evaluate(()=>area51Bonuses.balance),100);
  await page.waitForFunction(()=>area51Bonuses.engine.currentScene._area51Camera && !area51Bonuses.engine.currentScene.all['main-hero'].die);
  // Natural pickup must still win with hazard protection on.
  await configure({enabled:[-10],target:800});await page.waitForFunction(()=>area51Bonuses.finished);
  await page.locator('#bonus-finish').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>area51Bonuses.balance),1000);
  assert.deepEqual(errors,[]);
  console.log('PASS: 3 mobile resolutions, live resize, stable terrain camera, 3 jumps, snake immunity, natural fall death, restart balance, target victory. Diagnostics are test-only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
