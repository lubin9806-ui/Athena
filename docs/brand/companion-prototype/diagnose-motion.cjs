const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'athena-motion-diagnostic-')));
app.disableHardwareAcceleration();
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  const win = new BrowserWindow({show: false, width: 1440, height: 900, webPreferences: {offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false}});
  win.webContents.setFrameRate(30);
  const js = code => win.webContents.executeJavaScript(code);
  await win.loadFile(path.join(__dirname, 'index.html'));
  const result = [];
  const snap = async label => result.push({label, value: await js(`(() => { const n=document.querySelector('#tools-popover'); return {hidden:n.hidden,inert:n.inert,phase:n.dataset.transition,docHidden:document.hidden,time:performance.now(),animations:document.getAnimations().map(a=>({target:a.effect.target.id,time:a.currentTime,state:a.playState,timing:a.effect.getTiming()}))}; })()`) });
  await js(`document.querySelector('#btn-more').click()`); await snap('opened');
  await wait(600); await snap('open+600');
  await js(`document.querySelector('#btn-more').click()`); await snap('closed');
  await wait(600); await snap('close+600');
  await wait(1000); await snap('close+1600');
  await js(`document.querySelector('#btn-example').click()`); await wait(600);
  await js(`document.querySelector('#message-input').value='继续'; document.querySelector('#message-input').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#btn-send').click()`);
  await wait(150);
  for (const label of ['before-scroll','after-scroll','reply']) {
    if(label==='after-scroll') await js(`document.querySelector('#conversation-stage').scrollTop=0`);
    if(label==='reply') await wait(1200);
    result.push({label, value: await js(`(() => {let n=document.querySelector('#conversation-stage');return {top:n.scrollTop,height:n.scrollHeight,client:n.clientHeight,latest:document.querySelector('#btn-latest').hidden,state:document.querySelector('#prototype-app').dataset.state};})()`)});
  }
  fs.writeFileSync(path.join(__dirname,'evidence','motion-diagnostic.json'),JSON.stringify(result,null,2));
  win.destroy();app.exit();
})().catch(e=>{console.error(e);app.exit(1)});
