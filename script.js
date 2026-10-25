(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const rates = {easy:6, normal:8, hard:10};
  // Five synchronized art/caption phases at 20% intervals.
  // The original stage1 artwork is omitted from gameplay.
  const stages = [
    {image:"chiikawa_stage2",label:"발그레...",speech:"우..."},
    {image:"chiikawa_stage3",label:"꾸물꾸물...",speech:"우...우..."},
    {image:"chiikawa_stage4",label:"우물쭈물...",speech:"우...우아아..."},
    {image:"chiikawa_stage5",label:"울먹울먹...",speech:"아아...아아아..."},
    {image:"chiikawa_stage6",label:"그렁그렁...",speech:"아아아아아..."}
  ];
  const motionStageClasses = stages.map((_, i) => 'motion-stage-' + (i + 1));
  function encode(obj){return btoa(Array.from(new TextEncoder().encode(JSON.stringify(obj)), b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
  function decode(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))}
  // Preload all artwork that the game may show, retaining a decoded copy.
  // Stage6 also appears in the message ending; escape is the runaway ending; stage1 is unused.
  const characterDir = "assets/characters/";
  const artworkNames = ['chiikawa_stage2','chiikawa_stage3','chiikawa_stage4',
    'chiikawa_stage5','chiikawa_stage6','chiikawa_escape_custom'];
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

  // Prevent expressions from oscillating near the 20/40/60/80% boundaries.
  const MIN_STAGE_HOLD_MS = 850;  // Keep each changed expression for at least 0.85s.
  const DOWNWARD_BUFFER = 4;     // Require 4 percentage points below a boundary to go back.
  const STAGE_INTERVAL = 100 / stages.length;
  let visibleStageIndex = 0;
  let holdUntil = 0;
  let requestedScene = "";
  let displayedScene = "";
  let swapVersion = 0;
  let frontImage = $('stageImage');
  let backImage = $('stageImageNext');
  const FRAME_FADE_MS = 180;
  const MOTION_BLEND_MS = 220;
  const TEXT_FADE_MS = 120;
  let frameFadeTimer = null;
  let motionBlend = null;

  function cancelFrameFade() {
    if (frameFadeTimer !== null) clearTimeout(frameFadeTimer);
    frameFadeTimer = null;
    // A completed frame always remains visible while the unused buffer is hidden.
    backImage.classList.remove('frame-visible');
    backImage.classList.add('hidden');
  }
  function fadeUpdatedText(node) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        typeof node.animate !== 'function') return;
    node.animate([{opacity:.35},{opacity:1}], {duration:TEXT_FADE_MS, easing:'ease-out'});
  }

  function resetScene() {
    cancelFrameFade();
    if (motionBlend) { motionBlend.cancel(); motionBlend = null; }
    ++swapVersion; // Cancel any image decode callbacks from the preceding game.
    requestedScene = "";
    displayedScene = "";
    visibleStageIndex = 0;
    holdUntil = 0;
    $('characterMotion').classList.remove(...motionStageClasses);
    frontImage.classList.remove('frame-visible');
    backImage.classList.remove('frame-visible');
    frontImage.classList.add('hidden');
    backImage.classList.add('hidden');
    $('stageLabel').classList.add('hidden');
    $('speech').textContent = '';
    $('speech').closest('.speech-row').classList.add('hidden');
  }

  function commitScene(scene) {
    // Animate only the artwork container, not its caption or speech bubble.
    // Apply the motion on the same frame as the decoded image/caption swap.
    const motionLayer = $('characterMotion');
    const targetMotion = Number.isInteger(scene.stageIndex)
      ? motionStageClasses[scene.stageIndex] : null;
    if (!targetMotion || !motionLayer.classList.contains(targetMotion)) {
      // Bridge from the *currently rendered* movement rather than snapping to
      // the initial pose of the next stage's looping CSS animation.
      if (motionBlend) { motionBlend.cancel(); motionBlend = null; }
      const canBlend = !!targetMotion &&
        motionStageClasses.some(cls => motionLayer.classList.contains(cls)) &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        typeof motionLayer.animate === 'function';
      const previousPose = canBlend ? getComputedStyle(motionLayer).transform : null;
      motionLayer.classList.remove(...motionStageClasses);
      if (targetMotion) motionLayer.classList.add(targetMotion);
      if (canBlend && previousPose && previousPose !== 'none') {
        const newPose = getComputedStyle(motionLayer).transform;
        motionBlend = motionLayer.animate(
          [{transform:previousPose},{transform:newPose}],
          {duration:MOTION_BLEND_MS,easing:'ease-out'}
        );
      }
    }
    if ($('stageLabel').textContent !== scene.label) fadeUpdatedText($('stageLabel'));
    $('stageLabel').textContent = scene.label;
    $('stageLabel').classList.toggle('hidden', !!scene.hideLabel);
    if ($('speech').textContent !== scene.speech) fadeUpdatedText($('speech'));
    $('speech').textContent = scene.speech;
    $('speech').closest('.speech-row').classList.remove('hidden');
    if (scene.ending) {
      cancelEndingBuildup();
      $('endingBox').classList.remove('hidden');
    }
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

      // Crossfade two decoded frames without ever showing a blank character.
      // The old image stays under the new one until the 180ms transition ends.
      if (frameFadeTimer !== null) {
        clearTimeout(frameFadeTimer);
        frameFadeTimer = null;
      }
      const hadVisibleScene = !!displayedScene;
      const oldFrame = frontImage;
      const nextFrame = backImage;
      nextFrame.classList.remove('hidden','frame-visible');
      if (hadVisibleScene) {
        // Ensure the 0-opacity starting frame is committed before fading in.
        void nextFrame.offsetWidth;
      }
      nextFrame.classList.add('frame-visible');
      if (hadVisibleScene && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        frameFadeTimer = setTimeout(() => {
          frameFadeTimer = null;
          oldFrame.classList.remove('frame-visible');
          oldFrame.classList.add('hidden');
        }, FRAME_FADE_MS);
      } else {
        oldFrame.classList.remove('frame-visible');
        oldFrame.classList.add('hidden');
      }
      [frontImage, backImage] = [nextFrame, oldFrame];
      displayedScene = scene.key;
      if (Number.isInteger(scene.stageIndex)) {
        visibleStageIndex = scene.stageIndex;
        // The first frame is the starting state, not a transition to delay.
        holdUntil = hadVisibleScene ? performance.now() + MIN_STAGE_HOLD_MS : 0;
      }
      commitScene(scene);
    });
  }
  function show(id){$('creator').classList.toggle('hidden',id!=='creator');$('game').classList.toggle('hidden',id!=='game')}
  let config, value=0, finished=false, last=0, frame=0, previewMode=false;
  // Relay mode: round 0 escapes, round 1 has Usagi steal the message.
  let relayRound = 0;
  function effectiveEnding() {
    return config.ending === 'relay' ? (relayRound === 0 ? 'escape' : 'message') : config.ending;
  }
  function updateRetryLabel() {
    $('retry').textContent = config.ending === 'relay' && relayRound === 0
      ? '이번에는 다를지도...?' : '다시 하기';
  }
  const ENDING_BUILDUP_MS = 1300;
  let endingTimer = null;
  let impactTimer = null;
  let tapBounce = null;

  function cancelEndingBuildup() {
    if (endingTimer !== null) clearTimeout(endingTimer);
    if (impactTimer !== null) clearTimeout(impactTimer);
    endingTimer = null;
    impactTimer = null;
    $('game').classList.remove('is-ending-transition', 'is-usagi-entry', 'is-usagi-finale', 'is-knockback');
    $('characterMotion').classList.remove('ending-shiver');
    $('usagiMotion').classList.add('hidden');
    $('usagiFinal').classList.add('hidden');
    $('usagiImpact').classList.add('hidden');
    $('userMessage').classList.add('hidden');
    $('knockbackImage').classList.add('hidden');
  }

  // The custom-message ending is deliberately stolen by Usagi.
  function beginUsagiEntrance() {
    cancelEndingBuildup();
    $('game').classList.add('is-usagi-entry');
    $('speech').textContent = '이얏하~!';
    $('speech').closest('.speech-row').classList.remove('hidden');
    $('stageLabel').textContent = '우사기 등장!';
    $('stageLabel').classList.remove('hidden');
    $('usagiImpact').classList.remove('hidden');
    $('usagiFinal').classList.add('hidden');
    $('usagiMotion').classList.remove('hidden');
    // Change expression at impact; animate the wrapper for the next 0.7s.
    impactTimer = setTimeout(() => {
      impactTimer = null;
      $('knockbackImage').classList.remove('hidden');
      $('game').classList.add('is-knockback');
    }, 110);
    endingTimer = setTimeout(finishUsagiEntrance, 860);
  }

  function finishUsagiEntrance() {
    endingTimer = null;
    if (impactTimer !== null) clearTimeout(impactTimer);
    impactTimer = null;
    $('game').classList.remove('is-usagi-entry', 'is-knockback');
    $('knockbackImage').classList.add('hidden');
    $('game').classList.add('is-usagi-finale');
    $('usagiMotion').classList.add('hidden');
    $('usagiFinal').classList.remove('hidden');
    $('usagiImpact').classList.add('hidden');
    $('stageLabel').classList.add('hidden');
    $('speech').textContent = config.message;
    $('endingTitle').classList.add('hidden');
    $('endingBox').classList.remove('escape-ending', 'hidden');
    $('endingQuote').classList.add('hidden');
    $('userMessage').textContent = '우라~!';
    $('userMessage').classList.remove('hidden');
    $('endingText').textContent = '치이카와는 결국 쫓겨나버렸습니다.';
    updateRetryLabel();
  }

  function revealEnding() {
    // Display the ending independent of image loading/decoding.
    cancelEndingBuildup();
    const isEscape = effectiveEnding() === 'escape';
    $('endingBox').classList.toggle('escape-ending', isEscape);
    $('endingTitle').textContent = isEscape ? '' : '드디어 말했다!';
    $('endingTitle').classList.toggle('hidden', isEscape);
    $('endingText').textContent = isEscape
      ? '치이카와는 결국 부끄러움을 이기지 못하고 도망갔습니다.'
      : config.message;
    $('endingQuote').classList.toggle('hidden', !isEscape);
    const endingScene = {
      key: 'ending-' + effectiveEnding(),
      image: isEscape ? 'chiikawa_escape_custom' : 'chiikawa_stage6',
      label: isEscape ? '' : '드디어 말했다!',
      hideLabel: isEscape,
      speech: isEscape ? '우와아아앙!!!' : '아... 말해버렸다!',
      ending: true
    };
    commitScene(endingScene);
    setScene(endingScene); // Switch artwork when ready; text is already visible.
    // Persist beyond the shiver cleanup and asynchronous artwork swap.
    $('game').classList.toggle('is-escape-finale', isEscape);
    updateRetryLabel();
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function bounceTapButton() {
    if (reduceMotion.matches || typeof $('tap').animate !== 'function') return;
    // Cancel the previous bounce so every rapid tap gets an immediate response.
    if (tapBounce) tapBounce.cancel();
    tapBounce = $('tap').animate([
      {transform:'translateY(2px) scale(0.955)',offset:0},
      {transform:'translateY(-3px) scale(1.035)',offset:0.46},
      {transform:'translateY(0) scale(1)',offset:1}
    ], {duration:190,easing:'cubic-bezier(.2,.8,.3,1)',iterations:1});
  }

  function chooseStageIndex(now) {
    // While a frame is locked, the gauge still changes normally.
    if (now < holdUntil) return visibleStageIndex;
    let index = visibleStageIndex;
    while (index < stages.length - 1 && value >= (index + 1) * STAGE_INTERVAL) index++;
    while (index > 0 && value < index * STAGE_INTERVAL - DOWNWARD_BUFFER) index--;
    return index;
  }

  function render(){
    $('percent').textContent=Math.round(value)+'%';$('bar').style.width=value+'%';
    $('meter').setAttribute('aria-valuenow',Math.round(value));
    $('gameHint').textContent = config.panic && value >= 70 && !finished
      ? '치이카와가 더 부끄러워하고 있어!'
      : '버튼을 빠르게 눌러 100%를 채워주세요.';
    if(!finished){
      const index=chooseStageIndex(performance.now());
      setScene({key:'stage-'+index,stageIndex:index,...stages[index]});
    }
  }
  function tick(t){
    if(!last)last=t;
    const dt=Math.min((t-last)/1000,.25);last=t;
    if(!finished){value=Math.max(0,value-rates[config.difficulty]*(config.panic&&value>=70?2:1)*dt);render();frame=requestAnimationFrame(tick)}
  }
  function stop(){cancelAnimationFrame(frame);frame=0;last=0}
  function start(cfg, isPreview=false, preserveRelayRound=false){
    stop();
    if (!preserveRelayRound) relayRound = 0;
    cancelEndingBuildup();
    $('game').classList.remove('is-escape-finale');
    if (tapBounce) { tapBounce.cancel(); tapBounce = null; }
    resetScene();config=cfg;value=0;finished=false;previewMode=isPreview;show('game');
    $('gameTitle').textContent=cfg.title;
    $('backToCreator').classList.toggle('hidden',!previewMode);
    $('tap').classList.remove('hidden');$('endingBox').classList.add('hidden');
    $('endingBox').classList.remove('escape-ending');
    $('endingTitle').classList.remove('hidden');
    $('endingQuote').classList.add('hidden');
    $('retry').textContent = '다시 하기';
    // Stage captions become visible together with the decoded first artwork.
    render();frame=requestAnimationFrame(tick);
  }
  $('tap').addEventListener('click',()=>{
    if(finished)return;
    bounceTapButton();
    value=Math.min(100,value+5);
    if(value>=100){
      finished=true;
      stop();
      render(); // Freeze the full gauge at 100%.
      if (tapBounce) { tapBounce.cancel(); tapBounce = null; }
      // Do not leave a fading buffer on screen during the 100% buildup.
      cancelFrameFade();
      if (motionBlend) { motionBlend.cancel(); motionBlend = null; }
      // Cancel a still-decoding gameplay frame to prevent text from reappearing.
      ++swapVersion;
      requestedScene = '';
      $('game').classList.add('is-ending-transition');
      $('speech').textContent = '우...';
      $('speech').closest('.speech-row').classList.remove('hidden');
      $('characterMotion').classList.remove(...motionStageClasses);
      $('characterMotion').classList.add('ending-shiver');

      endingTimer = setTimeout(
        effectiveEnding() === 'message' ? beginUsagiEntrance : revealEnding,
        ENDING_BUILDUP_MS
      );
    }else render();
  });
  $('retry').addEventListener('click',()=>{
    if (config.ending === 'relay') {
      relayRound = relayRound === 0 ? 1 : 0;
      start(config, previewMode, true);
    } else {
      start(config, previewMode);
    }
  });
  $('backToCreator').addEventListener('click',()=>{
    stop();
    cancelEndingBuildup();
    cancelFrameFade();
    if (motionBlend) { motionBlend.cancel(); motionBlend = null; }
    $('game').classList.remove('is-escape-finale');
    ++swapVersion;
    requestedScene = '';
    previewMode=false;
    $('backToCreator').classList.add('hidden');
    show('creator');
  });
  document.querySelectorAll('input[name=ending]').forEach(el=>el.addEventListener('change',()=>{
    $('messageWrap').classList.toggle('hidden',!['message','relay'].includes(document.querySelector('input[name=ending]:checked').value));
  }));
  $('makeLink').addEventListener('click',()=>{
    const ending=document.querySelector('input[name=ending]:checked').value;
    const cfg={title:$('titleInput').value.trim()||'치이카와가 할 말이 있대...',ending,message:$('messageInput').value.trim(),difficulty:$('difficulty').value,panic:$('panic').checked};
    if(['message','relay'].includes(ending)&&!cfg.message){$('createError').textContent='우사기 엔딩에서 보여줄 메시지를 입력하세요.';return}
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
      if(!cfg||!['escape','message','relay'].includes(cfg.ending)||!Object.prototype.hasOwnProperty.call(rates,cfg.difficulty)||typeof cfg.title!=='string'||typeof cfg.message!=='string'||typeof cfg.panic!=='boolean')throw Error('invalid');
      start(cfg);
    }catch{show('creator');$('createError').textContent='유효하지 않은 게임 링크입니다. 새로 만들어 주세요.'}
  }else show('creator');
})();