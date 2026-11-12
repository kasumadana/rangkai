const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [320,390,1440]) {
   const page = await browser.newPage({viewport:{width,height:800}});
   await page.route('**/api/**', route => route.fulfill({json:{events:[],roads:[]}}));
   await page.goto('http://127.0.0.1:5204/peta');
   const trigger=page.getByRole('button',{name:'Buka Menu'});
   const menu=page.getByRole('dialog',{name:'Menu Ponsel Peta'});
   assert.equal(await menu.count(),0);
   if (width < 1440) {
    await trigger.focus();
    for(let i=0;i<10;i++){await page.keyboard.press('Tab'); assert.equal(await menu.count(),0); const box=await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return {x:r.x,right:r.right}}); assert.ok(box.x>=0 && box.right<=width,JSON.stringify(box));}
    await trigger.click(); await menu.waitFor();
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);
    const items=menu.locator('a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])');
    await items.last().focus(); await page.keyboard.press('Tab'); assert.equal(await items.first().evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await items.last().evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.querySelector('.map-desktop-topbar').inert),true);
    await page.keyboard.press('Escape'); assert.equal(await menu.count(),0); assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
    const mapControl=page.getByRole('button',{name:'Pusatkan Peta ke Lokasi Saya'}); await mapControl.focus(); assert.equal(await mapControl.evaluate(e=>e===document.activeElement),true); await page.keyboard.press('Enter');
    await trigger.click(); await page.locator('.mobile-nav-overlay').click({position:{x:5,y:5}}); assert.equal(await menu.count(),0);
    await trigger.click(); await menu.getByRole('link',{name:'Jadwal Upacara'}).click(); await page.waitForURL('**/events'); assert.equal(await menu.count(),0);
    await page.goto('http://127.0.0.1:5204/peta'); assert.equal(await page.locator('.map-desktop-topbar').evaluate(e=>e.inert),false);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   console.log(`PASS ${width}: closed navigation, modal and layout`); await page.close();
  }
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});

