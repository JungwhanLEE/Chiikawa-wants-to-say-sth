(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const rates = {easy:10, normal:20, hard:30};
  const stages = [
    {label:"1단계 · 머뭇머뭇",speech:"우... 우...",icon:"♡"},
    {label:"2단계 · 얼굴 빨개짐",speech:"아... 잠깐만...",icon:"♥"},
    {label:"3단계 · 심하게 부끄러움",speech:"아아... 으으...",icon:"!!"},
    {label:"4단계 · 눈물 맺힘",speech:"으아... 울 것 같아...",icon:"ㅠㅠ"}
  ];
  function encode(obj){return btoa(Array.from(new TextEncoder().encode(JSON.stringify(obj)), b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
  function decode(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))}
  function show(id){$('creator').classList.toggle('hidden',id!=='creator');$('game').classList.toggle('hidden',id!=='game')}
  let config, value=0, finished=false, last=0, frame=0;
  function render(){
    const stage=stages[Math.min(3,Math.floor(Math.min(value,99.99)/25))];
    $('percent').textContent=Math.round(value)+'%';$('bar').style.width=value+'%';
    $('meter').setAttribute('aria-valuenow',Math.round(value));
    $('stageLabel').textContent=stage.label;$('stageEmoji').textContent=stage.icon;
    if(!finished)$('speech').textContent=stage.speech;
  }
  function tick(t){
    if(!last)last=t;
    const dt=Math.min((t-last)/1000,.25);last=t;
    if(!finished){value=Math.max(0,value-rates[config.difficulty]*(config.panic&&value>=80?2:1)*dt);render();frame=requestAnimationFrame(tick)}
  }
  function stop(){cancelAnimationFrame(frame);frame=0;last=0}
  function start(cfg){
    stop();config=cfg;value=0;finished=false;show('game');
    $('gameTitle').textContent=cfg.title;
    $('tap').classList.remove('hidden');$('endingBox').classList.add('hidden');
    render();frame=requestAnimationFrame(tick);
  }
  $('tap').addEventListener('click',()=>{
    if(finished)return;
    value=Math.min(100,value+8);
    if(value>=100){
      finished=true;stop();render();$('tap').classList.add('hidden');
      $('endingBox').classList.remove('hidden');
      $('endingTitle').textContent=config.ending==='escape'?'으아아앙! 도망갔다!':'드디어 말했다!';
      $('endingText').textContent=config.ending==='escape'?'치이카와는 결국 부끄러움을 이기지 못하고 도망갔습니다.':config.message;
      $('speech').textContent=config.ending==='escape'?'우와아아앙!!!':'아... 말해버렸다!';
    }else render();
  });
  $('retry').addEventListener('click',()=>start(config));
  document.querySelectorAll('input[name=ending]').forEach(el=>el.addEventListener('change',()=>{
    $('messageWrap').classList.toggle('hidden',document.querySelector('input[name=ending]:checked').value!=='message');
  }));
  $('makeLink').addEventListener('click',()=>{
    const ending=document.querySelector('input[name=ending]:checked').value;
    const cfg={title:$('titleInput').value.trim()||'치이카와가 할 말이 있대...',ending,message:$('messageInput').value.trim(),difficulty:$('difficulty').value,panic:$('panic').checked};
    if(ending==='message'&&!cfg.message){$('createError').textContent='말하기 엔딩의 메시지를 입력하세요.';return}
    $('createError').textContent='';
    const url=new URL(location.href);url.search='';url.hash='';
    url.searchParams.set('game',encode(cfg));$('shareLink').value=url.href;
    $('linkArea').classList.remove('hidden');
  });
  $('copyLink').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('shareLink').value);$('copyLink').textContent='복사 완료!'}
    catch{$('shareLink').select();$('copyLink').textContent='주소를 선택했어요. 직접 복사해 주세요.'}
  });
  $('previewLink').addEventListener('click',()=>{
    try{const u=new URL($('shareLink').value);start(decode(u.searchParams.get('game')))}catch{alert('링크를 다시 만들어 주세요.')}
  });
  if(params.has('game')){
    try{
      const cfg=decode(params.get('game'));
      if(!cfg||!['escape','message'].includes(cfg.ending)||!Object.prototype.hasOwnProperty.call(rates,cfg.difficulty)||typeof cfg.title!=='string'||typeof cfg.message!=='string'||typeof cfg.panic!=='boolean')throw Error('invalid');
      start(cfg);
    }catch{show('creator');$('createError').textContent='유효하지 않은 게임 링크입니다. 새로 만들어 주세요.'}
  }else show('creator');
})();