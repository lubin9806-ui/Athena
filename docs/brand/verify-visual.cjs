// Review-page QA only. Does not launch Athena or access user configuration.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'athena-visual-review-'));
app.setPath('userData',profile);
app.setPath('sessionData',profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({show:false,width:1280,height:920,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.setContentSize(1280,980);
  const errors=[];
  win.webContents.on('console-message', (...args) => {
    const details = args[1];
    if(typeof details === 'object' && details.level === 'error') errors.push(details.message);
  });
  await win.loadFile(path.join(__dirname,'visual-system.html'));
  await win.webContents.executeJavaScript(`Promise.all([document.fonts.ready,...Array.from(document.images, i => i.decode())])`);
  const evaluate = code => win.webContents.executeJavaScript(code);
  const captures=[];
  const contrast=[];
  for(const theme of ['day','night']) {
    await evaluate(`if(document.documentElement.dataset.theme !== '${theme}') document.querySelector('#theme-toggle').click();`);
    const values=await evaluate(`(() => {
      const s=getComputedStyle(document.documentElement);
      return Object.fromEntries(['bg','surface','surface-soft','text','muted','accent','on-accent','danger','focus'].map(k=>[k,s.getPropertyValue('--athena-'+k).trim()]));
    })()`);
    const luminance=hex=>{const a=hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
    for(const [fg,bg] of [['text','bg'],['text','surface'],['muted','bg'],['muted','surface'],['muted','surface-soft'],['on-accent','accent'],['accent','surface'],['danger','surface'],['focus','bg']]) {
      const a=luminance(values[fg]),b=luminance(values[bg]);
      const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      assert(ratio>=4.5,`${theme} ${fg}/${bg}: ${ratio}`);
      contrast.push({theme,fg,bg,ratio:Number(ratio.toFixed(2))});
    }
    await evaluate(`window.scrollTo({top:document.querySelector('#interface').getBoundingClientRect().top+scrollY-16,behavior:'instant'})`);
    await new Promise(resolve=>setTimeout(resolve,300));
    const image=await win.webContents.capturePage();
    const file=`visual-ui-${theme}.png`;
    fs.writeFileSync(path.join(__dirname,file),image.toPNG());
    captures.push(file);
  }
  const interaction=await evaluate(`(() => {
    const check=(v,m)=>{if(!v)throw Error(m)};
    check(document.querySelector('#send-demo').disabled,'Empty send');
    document.querySelector('.space-switch [data-space="work"]').click();
    check(!document.querySelector('.work-switch').hidden,'Work navigation');
    document.querySelector('[data-mode="reason"]').click();
    check(document.querySelector('#demo-title').textContent==='先把问题看清楚。','Reason copy');
    document.querySelector('[data-prompt]').click();
    check(!document.querySelector('#send-demo').disabled,'Prompt entry');
    document.querySelector('#send-demo').click();
    check(document.querySelector('.app-demo').dataset.state==='working','Submit');
    document.querySelector('#send-demo').click();
    check(document.querySelector('.app-demo').dataset.state==='idle','Stop');
    const picker=document.querySelector('#state-picker');
    for(const state of ['success','error']) {picker.value=state;picker.dispatchEvent(new Event('change'));check(document.querySelector('.app-demo').dataset.state===state,state);}
    document.querySelector('#settings-toggle').click();
    check(!document.querySelector('#settings-panel').hidden,'Open settings');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    check(document.querySelector('#settings-panel').hidden,'Close settings');
    check(document.activeElement.id==='settings-toggle','Restore focus');
    document.querySelector('#solid-toggle').click();
    check(document.documentElement.dataset.solid==='true','Solid surface');
    document.querySelector('#new-demo').click();
    check(document.querySelector('#send-demo').disabled,'Reset');
    return {passed:true,checks:12};
  })()`);
  win.setContentSize(390,844);
  await new Promise(resolve=>setTimeout(resolve,250));
  await evaluate(`window.scrollTo({top:document.querySelector('.app-demo').getBoundingClientRect().top+scrollY-12,behavior:'instant'})`);
  await new Promise(resolve=>setTimeout(resolve,300));
  const layout=await evaluate(`({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:Array.from(document.images).every(i=>i.naturalWidth>0),fontStatus:document.fonts.status})`);
  assert(layout.scrollWidth<=layout.viewport,'Mobile horizontal overflow');
  assert(layout.images,'Image decode');
  fs.writeFileSync(path.join(__dirname,'visual-ui-mobile.png'),(await win.webContents.capturePage()).toPNG());
  captures.push('visual-ui-mobile.png');
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(__dirname,'visual-qa.json'),JSON.stringify({scope:'Standalone design review, not Athena runtime',contrast,interaction,layout,errors,captures},null,2)+'\n');
  console.log('ATHENA_VISUAL_REVIEW_OK '+JSON.stringify({contrastChecks:contrast.length,interaction,layout,captures}));
  win.destroy();app.quit();
}
run().catch(error=>{console.error(error);app.exit(1)});
