/* Real browser camera, enemy collision and pit recovery checks. Requires HTTP server. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://api.adinplay.com/**',route=>route.abort());
    await page.goto(process.env.AREA51_TEST_URL||'http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.area51Bonuses?.engine.currentScene);
    assert.equal(await page.evaluate(()=>area51Bonuses.settings.noLose),true);
    await page.mouse.click(640,445);
    await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='main');
    async function configure(noLose=true) {
      await page.keyboard.press('F2');
      await page.locator('[name=jumpStrength]').fill('38');
      await page.locator('[name=noLose]').selectOption(String(noLose));
      for(const box of await page.locator('[name=enabled]').all())await box.uncheck();
      await page.locator('[type=submit]').click();
      await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='level/1' && area51Bonuses.engine.currentScene.all['main-hero'].jumpEnabled);
      await page.waitForFunction(()=>area51Bonuses.engine.currentScene._area51Camera?.zoom<.78);
    }
    await configure();
    await page.evaluate(()=>{
      window.cameraProbe={started:false,done:false,die:false,samples:[]};
      function sample(){
        const a=area51Bonuses,s=a.engine.currentScene,h=s.all['main-hero'],p=cameraProbe;
        if(h.ySpeed<-5)p.started=true;
        if(p.started){
          const surface=s.getGroundY(h.x);
          const ground=Number.isFinite(surface)?surface:s.groundLayer.children.find(g=>g.x>h.x)?.y;
          const groundScreen=h.parent.toGlobal({x:h.x,y:ground}).y;
          const end=s.groundLayer.children.at(-1);
          const right=end.parent.toGlobal({x:end.x+end.nextPosX,y:end.y}).x;
          p.samples.push({zoom:s._area51Camera.zoom,ground:groundScreen,top:h.getBounds().y,
            anchor:h.toGlobal({x:0,y:-350}).y,right,air:ground-h.y});
          if(h.canJump)p.done=true;
        }
        p.die=h.die;
        if(!p.done&&!p.die)requestAnimationFrame(sample);
      }requestAnimationFrame(sample);
    });
    await page.keyboard.down('Space');
    await page.waitForFunction(()=>cameraProbe.started);
    await page.keyboard.up('Space');
    await page.waitForFunction(()=>cameraProbe.samples.some(s=>s.air>250));
    await page.screenshot({path:'/tmp/area51-wide-jump.png'});
    await page.waitForFunction(()=>cameraProbe.done||cameraProbe.die);
    const probe=await page.evaluate(()=>cameraProbe);
    assert(!probe.die);assert(probe.samples.length>10);
    const airborne=probe.samples.filter(s=>s.air>150);
    assert(airborne.every(s=>s.ground<790),'landing terrain should remain in view');
    assert(airborne.every(s=>s.anchor>42 && s.top>0),'head and balance should remain visible');
    assert(probe.samples.every(s=>s.right>=1280),'zoom must generate terrain to the right edge');
    assert(Math.min(...probe.samples.map(s=>s.zoom))<.74,'high jumps should smoothly zoom out further');
    for(let i=1;i<probe.samples.length;i++)assert(Math.abs(probe.samples[i].zoom-probe.samples[i-1].zoom)<.035,'no sudden zoom jumps');
    console.log('Camera', {samples:probe.samples.length,minZoom:Math.min(...probe.samples.map(s=>s.zoom)),maxGround:Math.max(...airborne.map(s=>s.ground))});
    async function nativeEnemy(type) {
      await page.evaluate(type=>{
        const a=area51Bonuses,s=a.engine.currentScene,h=s.all['main-hero'];
        const ground=s.groundLayer.children.find(g=>g.x>h.x+160&&g.groundWidth>90);
        if(!ground)throw Error('No native platform for enemy fixture');
        if(ground.enemy)ground.enemy.remove();
        const enemy=a.engine.Lib.loadPrefab(type);ground.addChild(enemy);ground.enemy=enemy;
        const offset=50;
        const position=ground.toLocal({x:ground.x+offset,y:ground.y+offset/ground.groundWidth*ground.groundYShift},ground.parent);
        enemy.position.set(position.x,position.y);
        window.enemyCatches=0;
        const original=enemy.gotoLabelRecursive;
        enemy.gotoLabelRecursive=function(label,...args){if(label==='catch')window.enemyCatches++;return original.call(this,label,...args);};
      },type);
      await page.waitForFunction(()=>enemyCatches>0 || area51Bonuses.engine.currentScene.all['main-hero'].die);
    }
    for(const type of ['snake','trap']){
      await nativeEnemy(type);
      const result=await page.evaluate(()=>{const s=area51Bonuses.engine.currentScene;return {catches:enemyCatches,die:s.all['main-hero'].die,speed:s.currentXSpeed,distance:s.currentDistance};});
      assert(result.catches>0,'original enemy catch animation must execute');
      assert(!result.die);assert(result.speed<0);
      await page.waitForFunction(d=>area51Bonuses.engine.currentScene.currentDistance>d+1,result.distance);
      console.log(type,'collision preserved, run continues');
    }
    // Run off a real generated gap without jumping. Let original gravity cause the fall.
    await page.waitForFunction(()=>area51Bonuses.engine.currentScene._area51Rescues>0,{},{timeout:60000});
    const recovered=await page.evaluate(()=>{const a=area51Bonuses,s=a.engine.currentScene,h=s.all['main-hero'];return {rescues:s._area51Rescues,die:h.die,y:h.y,ground:s.getGroundY(h.x),balance:a.balance,distance:s.currentDistance,same:s._area51LastRecovery.ground===s._area51Safe.ground,returned:s._area51LastRecovery.y,returnSurface:s._area51LastRecovery.ground.y+s._area51Safe.offset/s._area51Safe.ground.groundWidth*s._area51Safe.ground.groundYShift};});
    assert(!recovered.die);assert(Math.abs(recovered.returned-recovered.returnSurface)<30);assert(recovered.same);
    assert.equal(recovered.balance,100);
    console.log('Natural pit recovery',recovered);
    await page.screenshot({path:'/tmp/area51-safe-recovery.png'});
    await page.waitForFunction(d=>area51Bonuses.engine.currentScene.currentDistance>d+5,recovered.distance);
    assert.equal(await page.evaluate(()=>area51Bonuses.engine.currentScene._area51Rescues),recovered.rescues,'rescue jump must clear the same gap');

    await configure(false);
    await nativeEnemy('snake');
    const death=await page.evaluate(()=>{const s=area51Bonuses.engine.currentScene;return {die:s.all['main-hero'].die,speed:s.currentXSpeed,popup:s.all['gameover-popup'].isPlaying};});
    assert(death.die);assert.equal(death.speed,0);assert(death.popup);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.area51Bonuses?.engine.currentScene);
    assert.equal(await page.evaluate(()=>area51Bonuses.settings.noLose),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: wide/dynamic camera, ground coverage, native snake/trap collisions, natural pit recovery, original Game Over when disabled, persistence.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
