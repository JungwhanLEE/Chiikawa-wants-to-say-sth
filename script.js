(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const rates = {easy:6, normal:8, hard:10};
  // Four expression and caption transitions share the same 25% thresholds.
  // The original stage1 artwork is omitted from gameplay.
  const stages = [
    {image:"chiikawa_stage2",label:"발그레...",speech:"우..."},
    {image:"chiikawa_stage3",label:"꾸물꾸물...",speech:"우...우..."},
    {image:"chiikawa_stage4",label:"우물쭈물...",speech:"우...우아아..."},
    {image:"chiikawa_stage5",label:"울먹울먹...",speech:"아아...아아아..."}
  ];
  function encode(obj){return btoa(Array.from(new TextEncoder().encode(JSON.stringify(obj)), b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
  function decode(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))}
  // Preload all artwork that the game may show, retaining a decoded copy.
  // stage6 is the message ending, escape is the runaway ending; stage1 is unused.
  const characterDir = "assets/characters/";
  const artworkNames = ['chiikawa_stage2','chiikawa_stage3','chiikawa_stage4',
    'chiikawa_stage5','chiikawa_stage6','chiikawa_escape'];
  const artworkCache = new Map(artworkNames.map(name => {
    const image = new Image();
    image.src = characterDir + name + ".png";
    const ready = typeof image.decode === "function"
      ? image.decode().then(() => true, () => image.complete && image.naturalWidth > 0)
      : new Promise(resolve => {
          if (image.complete) return resolve(image.naturalWidth > 0);
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
        });
    return [name, {url: image.src, ready}];
  }));

  let requestedScene = "";
  let displayedScene = "";
  let swapVersion = 0;
  let frontImage = $('stageImage');
  let backImage = $('stageImageNext');

  function resetScene() {
    ++swapVersion; // Cancel any image decode callbacks from the preceding game.
    requestedScene = "";
    displayedScene = "";
    frontImage.classList.add('hidden');
    backImage.classList.add('hidden');
    $('stageLabel').classList.add('hidden');
    $('speech').textContent = '';
    $('speech').closest('.speech-row').classList.add('hidden');
  }

  function commitScene(scene) {
    $('stageLabel').textContent = scene.label;
    $('stageLabel').classList.toggle('hidden', !!scene.hideLabel);
    $('speech').textContent = scene.speech;
    $('speech').closest('.speech-row').classList.remove('hidden');
    if (scene.ending) $('endingBox').classList.remove('hidden');
  }

  function setScene(scene) {
    if (requestedScene === scene.key) return;
    requestedScene = scene.key;
    const version = ++swapVersion;
    const asset = artworkCache.get(scene.image);
    if (!asset) {
      if (scene.ending) commitScene(scene);
      return;
    }

    if (displayedScene === scene.key) {
      // The correct frame is already visible: cancel a pending outdated change.
      commitScene(scene);
      return;
    }

    asset.ready.then(async loaded => {
      if (version !== swapVersion || requestedScene !== scene.key) return;
      if (!loaded) {
        // Even if the ending image cannot load, never suppress the ending message.
        if (scene.ending) commitScene(scene);
        return;
      }
      // Decode on the hidden buffer while the previous frame remains displayed.
      backImage.src = asset.url;
      try {
        if (typeof backImage.decode === 'function') await backImage.decode();
      } catch {
        if (!backImage.complete || !backImage.naturalWidth) {
          if (scene.ending && version === swapVersion) commitScene(scene);
          return;
        }
      }
      if (version !== swapVersion || requestedScene !== scene.key) return;
      if (!backImage.complete || !backImage.naturalWidth) return;

      // Swap artwork and both captions in one synchronous turn.
      backImage.classList.remove('hidden');
      frontImage.classList.add('hidden');
      [frontImage, backImage] = [backImage, frontImage];
      displayedScene = scene.key;
      commitScene(scene);
    });
  }
  function show(id){$('creator').classList.toggle('hidden',id!=='creator');$('game').classList.toggle('hidden',id!=='game')}
  let config, value=0, finished=false, last=0, frame=0, previewMode=false;
  function render(){
    $('percent').textContent=Math.round(value)+'%';$('bar').style.width=value+'%';
    $('meter').setAttribute('aria-valuenow',Math.round(value));
    if(!finished){
      const index=Math.min(3,Math.floor(Math.min(value,99.99)/25));
      setScene({key:'stage-'+index,...stages[index]});
    }
  }
  function tick(t){
    if(!last)last=t;
    const dt=Math.min((t-last)/1000,.25);last=t;
    if(!finished){value=Math.max(0,value-rates[config.difficulty]*(config.panic&&value>=70?2:1)*dt);render();frame=requestAnimationFrame(tick)}
  }
  function stop(){cancelAnimationFrame(frame);frame=0;last=0}
  function start(cfg, isPreview=false){
    stop();resetScene();config=cfg;value=0;finished=false;previewMode=isPreview;show('game');
    $('gameTitle').textContent=cfg.title;
    $('backToCreator').classList.toggle('hidden',!previewMode);
    $('tap').classList.remove('hidden');$('endingBox').classList.add('hidden');
    $('endingBox').classList.remove('escape-ending');
    $('endingTitle').classList.remove('hidden');
    $('endingQuote').classList.add('hidden');
    $('stageLabel').classList.remove('hidden');
    render();frame=requestAnimationFrame(tick);
  }
  $('tap').addEventListener('click',()=>{
    if(finished)return;
    value=Math.min(100,value+5);
    if(value>=100){
      finished=true;stop();render();$('tap').classList.add('hidden');
      const isEscape = config.ending === 'escape';
      $('endingBox').classList.toggle('escape-ending', isEscape);
      $('endingTitle').textContent = isEscape ? '' : '드디어 말했다!';
      $('endingTitle').classList.toggle('hidden', isEscape);
      $('endingText').textContent = isEscape
        ? '치이카와는 결국 부끄러움을 이기지 못하고 도망갔습니다.'
        : config.message;
      $('endingQuote').classList.toggle('hidden', !isEscape);
      setScene({
        key: 'ending-' + config.ending,
        image: isEscape ? 'chiikawa_escape' : 'chiikawa_stage6',
        label: isEscape ? '' : '드디어 말했다!',
        hideLabel: isEscape,
        speech: isEscape ? '우와아아앙!!!' : '아... 말해버렸다!',
        ending: true
      });
    }else render();
  });
  $('retry').addEventListener('click',()=>start(config, previewMode));
  $('backToCreator').addEventListener('click',()=>{
    stop();
    ++swapVersion;
    requestedScene = '';
    previewMode=false;
    $('backToCreator').classList.add('hidden');
    show('creator');
  });
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
    try{const u=new URL($('shareLink').value);start(decode(u.searchParams.get('game')), true)}catch{alert('링크를 다시 만들어 주세요.')}
  });
  if(params.has('game')){
    try{
      const cfg=decode(params.get('game'));
      if(!cfg||!['escape','message'].includes(cfg.ending)||!Object.prototype.hasOwnProperty.call(rates,cfg.difficulty)||typeof cfg.title!=='string'||typeof cfg.message!=='string'||typeof cfg.panic!=='boolean')throw Error('invalid');
      start(cfg);
    }catch{show('creator');$('createError').textContent='유효하지 않은 게임 링크입니다. 새로 만들어 주세요.'}
  }else show('creator');
})();