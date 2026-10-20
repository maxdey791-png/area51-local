/* Browser integration test. Start python3 -m http.server 8000 first. */
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const URL = process.env.AREA51_TEST_URL || 'http://127.0.0.1:8000/';
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,
    args:['--no-sandbox','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:800}});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    // Reproducible random terrain. No physics, collision or positions are mocked.
    await page.addInitScript(() => {
      let seed=813;
      Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    });
    await page.goto(URL,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.area51Bonuses?.engine.currentScene);
    await page.mouse.click(640,445);
    await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='main');
    async function configure({start=100,target=50000,frequency='rare',spacing=400,enabled=[100],currency='Bs',custom='',jumpStrength=32,bonusSize='2.5'}={}) {
      await page.keyboard.press('F2');
      for(const [key,value] of Object.entries({start,target,spacing,custom,jumpStrength})) {
        // Spacing is disabled until the custom frequency is selected.
        if(key==='spacing') continue;
        await page.locator(`[name=${key}]`).fill(String(value));
      }
      await page.locator('[name=frequency]').selectOption(frequency);
      if(frequency==='custom') await page.locator('[name=spacing]').fill(String(spacing));
      await page.locator('[name=currency]').selectOption(currency);
      await page.locator('[name=bonusSize]').selectOption(String(bonusSize));
      for(const box of await page.locator('[name=enabled]').all())
        await box.setChecked(enabled.includes(Number(await box.getAttribute('value'))));
      await page.locator('[type=submit]').click();
      await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='level/1' && area51Bonuses.engine.currentScene.all['main-hero'].jumpEnabled);
    }
    const state = () => page.evaluate(()=>{
      const a=area51Bonuses,s=a.engine.currentScene,h=s.all['main-hero'];
      const ground=s.getGroundY(h.x),anchor=h.toGlobal({x:0,y:-350});
      return {balance:a.balance,finished:a.finished,die:h.die,y:h.y,top:h.getBounds().y,
        ground,air:Number.isFinite(ground)?ground-h.y:null,v:h.ySpeed,canJump:h.canJump,
        distance:s.currentDistance,anchor:{x:anchor.x,y:anchor.y},
        items:a.items.map(i=>({x:i.ground.x+i.offset,world:s.currentDistance*90+i.ground.x+i.offset,radius:i.radius,value:i.value}))};
    });
    await configure();
    console.log('Initial',await state());
    // Collect in real time by letting the original runner reach the first pickup.
    await page.waitForFunction(()=>area51Bonuses.balance===200);
    let initial=await state();
    assert(!initial.die);
    assert(initial.y>500 && initial.y<720,'camera must settle the running surface in view');
    // Pause also makes a useful deterministic check that no balance accrues with time.
    await page.keyboard.press('F2');
    const paused=await state();await page.waitForTimeout(250);
    assert.equal((await state()).distance,paused.distance);
    assert.equal((await state()).balance,paused.balance);
    await page.locator('#bonus-close').click();
    // Several real Space presses, checking velocity, relative height, camera and landing.
    const jumps=[];
    for(let n=0;n<3;n++) {
      await page.waitForFunction(()=>{const h=area51Bonuses.engine.currentScene.all['main-hero'];return h.canJump&&!h.die;});
      await page.evaluate(()=>{
        window.jumpProbe={started:false,done:false,die:false,maxAir:0,minTop:Infinity,minAnchor:Infinity};
        function watch(){
          const probe=window.jumpProbe,s=area51Bonuses.engine.currentScene,h=s.all['main-hero'];
          if(h.ySpeed < -5)probe.started=true;
          probe.die=h.die;
          if(probe.started){
            const air=s.getGroundY(h.x)-h.y;
            if(Number.isFinite(air))probe.maxAir=Math.max(probe.maxAir,air);
            probe.minTop=Math.min(probe.minTop,h.getBounds().y);
            probe.minAnchor=Math.min(probe.minAnchor,h.toGlobal({x:0,y:-350}).y);
            if(h.canJump)probe.done=true;
          }
          if(!probe.done&&!probe.die)requestAnimationFrame(watch);
        }requestAnimationFrame(watch);
      });
      await page.keyboard.down('Space');
      await page.waitForFunction(()=>jumpProbe.started||jumpProbe.die);
      await page.keyboard.up('Space');
      await page.waitForFunction(()=>jumpProbe.done||jumpProbe.die);
      const probe=await page.evaluate(()=>jumpProbe);
      assert(!probe.die,'runner died during the jump');
      assert(probe.maxAir>200,'jump must be higher than the original impulse');
      assert(probe.minAnchor>=45,'balance must remain visible');
      assert(probe.minTop>=0,'hero must remain visible');
      jumps.push(probe);
      const landed=await state();assert(Math.abs(landed.air)<30,'runner should return to the platforms');
    }
    console.log('Three sequential jumps',jumps);
    // A small target: natural pickup must stop gameplay, not a timer or assigned balance.
    await configure({target:300,frequency:'custom',spacing:400});
    await page.waitForFunction(()=>area51Bonuses.finished);
    assert.equal((await state()).balance,300);
    await page.locator('#bonus-finish').waitFor({state:'visible'});
    assert.match(await page.locator('.finish-balance').innerText(),/300 Bs/);
    const finish=await state();await page.waitForTimeout(350);
    assert.equal((await state()).distance,finish.distance);
    assert.equal((await state()).y,finish.y);
    await page.screenshot({path:'/tmp/area51-finish.png'});
    await page.locator('#bonus-restart').click();
    assert.equal((await state()).balance,100);
    assert.equal((await state()).finished,false);
    await page.locator('#bonus-finish').waitFor({state:'hidden'});
    // Overshooting a target with a multiplier must also finish; test the largest size.
    await configure({target:800,enabled:[-10],bonusSize:'3'});
    const large=await state();
    assert(large.items.length>0 && large.items.every(item=>item.radius===72));
    await page.waitForFunction(()=>area51Bonuses.finished);
    assert.equal((await state()).balance,1000);
    assert.match(await page.locator('.finish-balance').innerText(),/1.000 Bs/);
    console.log('Multiplier overshoot finish: 100 × 10 = 1000, target 800');
    // Full configuration persistence, including disabling every pickup.
    await configure({target:50000,frequency:'custom',spacing:1234,enabled:[],currency:'custom',custom:'★',jumpStrength:35,bonusSize:'3'});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.area51Bonuses?.engine.currentScene);
    const saved=await page.evaluate(()=>area51Bonuses.settings);
    assert.equal(saved.spacing,1234);assert.equal(saved.jumpStrength,35);
    assert.equal(saved.bonusSize,3);assert.equal(saved.custom,'★');assert.deepEqual(saved.enabled,[]);
    await page.evaluate(()=>{window.isNotFirstRun=true;area51Bonuses.engine.replaceScene('level/1');});
    await page.waitForFunction(()=>area51Bonuses.engine.currentScene.name==='level/1' && area51Bonuses.engine.currentScene.all['main-hero']?.jumpEnabled);
    await page.waitForTimeout(300);
    assert.equal((await state()).items.length,0);
    assert.deepEqual(errors,[]);
    console.log('PASS: natural collection, camera, 3 jumps, F2 pause, target finish, restart, settings persistence, disabled bonuses.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
