// Pult-Fader: langer Schlitz, breite Kappe mit Farbstrich, dB-Skala.
// Der Wert ist die Pult-Position 0..1 (X32-"level"-Wert, 0.75 = 0 dB), verhält sich nach außen
// wie ein Schieberegler: .value lesen/setzen, "input" beim Ändern, "change" beim Loslassen.
//
// Bedienung: Kappe ziehen (relativ), in den Schlitz tippen = Kappe springt hin, Mausrad, Pfeiltasten.
// Feineinstellung (1/5 der Bewegung): Shift halten, ODER (Touch-Modus) den Finger auf der Kappe kurz ruhig halten,
// ODER (Touch-Modus) beim Ziehen seitlich vom Fader wegrücken. Doppeltippen/Doppelklick = 0 dB.
// Mehrere Fader gleichzeitig mit mehreren Fingern sind möglich (jeder Fader merkt sich seinen Finger).
const FADER_TICKS = [[10, '+10'], [5, '+5'], [0, '0'], [-5, '-5'], [-10, '-10'], [-20, '-20'], [-30, '-30'], [-40, '-40'], [-60, '-60'], [-90, 'oo']];
const FADER_UNITY = 0.75;
const FADER_FINE = 0.2;             // Empfindlichkeit in der Feineinstellung
const FADER_HOLD_MS = 380;          // so lange ruhig halten = Feineinstellung (Touch-Modus)
const FADER_FAR_PX = 90;            // so weit seitlich wegziehen = Feineinstellung (Touch-Modus)

function makeFader(){
  const root = document.createElement('div');
  root.className = 'fader';
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-orientation', 'vertical');
  root.setAttribute('aria-valuemin', '-90');
  root.setAttribute('aria-valuemax', '10');

  const scale = document.createElement('div');
  scale.className = 'fader-scale';
  FADER_TICKS.forEach(([db, label]) => {
    const t = db <= -90 ? 0 : X32V.dbToFader(db);
    const tick = document.createElement('div');
    tick.className = 'fader-tick' + (db === 0 ? ' zero' : '');
    tick.style.setProperty('--t', t);
    tick.innerHTML = '<span>' + label + '</span>';
    scale.appendChild(tick);
  });
  const track = document.createElement('div');
  track.className = 'fader-track';
  const fill = document.createElement('div');
  fill.className = 'fader-fill';
  track.appendChild(fill);
  const cap = document.createElement('div');
  cap.className = 'fader-cap';
  cap.innerHTML = '<div class="fader-cap-line"></div>';
  const bubble = document.createElement('div');       // Wert über der Kappe, damit der Finger ihn nicht verdeckt (Touch-Modus)
  bubble.className = 'fader-bubble';
  root.appendChild(scale);
  root.appendChild(track);
  root.appendChild(cap);
  root.appendChild(bubble);

  let value = 0, dragging = false, activeId = null;
  let baseY = 0, baseT = 0, baseSens = 1;
  let downAt = 0, downX = 0, downY = 0, lastX = 0, lastY = 0, centerX = 0, fineHold = false, fineTimer = 0, lastEventAt = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const touchMode = () => document.body.classList.contains('touch');

  function paint(){
    root.style.setProperty('--t', value);
    const db = value <= 0 ? -90 : X32V.faderToDb(value);
    root.setAttribute('aria-valuenow', db.toFixed(1));
    bubble.textContent = db <= -90 ? '-oo' : db.toFixed(1);
  }
  function fire(type){ root.dispatchEvent(new Event(type, { bubbles: true })); }
  function setFromUser(t){
    t = clamp01(t);
    if(t === value) return;
    value = t;
    paint();
    fire('input');
  }
  // Der Schlitz reicht von der Kappenmitte ganz unten bis zur Kappenmitte ganz oben
  function travel(){ return track.getBoundingClientRect().height; }
  function tFromY(y){
    const r = track.getBoundingClientRect();
    return clamp01(1 - (y - r.top) / r.height);
  }
  // leichtes Einrasten bei 0 dB (in der Feineinstellung deaktiviert)
  const snap = (t, fine) => (!fine && Math.abs(t - FADER_UNITY) < 0.007 ? FADER_UNITY : t);
  const sensFor = (e) => (e.shiftKey || fineHold || (touchMode() && Math.abs(e.clientX - centerX) > FADER_FAR_PX) ? FADER_FINE : 1);
  // Empfindlichkeit wechselt mitten im Ziehen: neu ansetzen, damit die Kappe nicht springt
  function rebase(y, sens){ baseSens = sens; baseY = y; baseT = value; root.classList.toggle('fine', sens < 1); }

  root.addEventListener('pointerdown', (e) => {
    if(e.button !== undefined && e.button !== 0) return;
    // ein zweiter Finger auf demselben Fader wird ignoriert, es sei denn, der erste meldet sich schon lange nicht mehr (verlorenes Loslassen)
    if(dragging && e.pointerId !== activeId && performance.now() - lastEventAt < 1500) return;
    clearTimeout(fineTimer);
    e.preventDefault();
    root.focus({ preventScroll: true });
    dragging = true; activeId = e.pointerId;
    try { root.setPointerCapture(e.pointerId); } catch(err){}
    const r = root.getBoundingClientRect();
    centerX = r.left + r.width / 2;
    downAt = lastEventAt = performance.now(); downX = lastX = e.clientX; downY = lastY = e.clientY;
    fineHold = false;
    if(!cap.contains(e.target)) setFromUser(snap(tFromY(e.clientY), e.shiftKey));   // Klick in den Schlitz: Kappe springt hin
    baseY = e.clientY; baseT = value; baseSens = sensFor(e);
    root.classList.toggle('fine', baseSens < 1);
    root.classList.add('active');
    clearTimeout(fineTimer);
    if(touchMode()) fineTimer = setTimeout(() => {            // Finger ruhig gehalten -> Feineinstellung
      fineTimer = 0;
      if(dragging && Math.hypot(lastX - downX, lastY - downY) < 8){ fineHold = true; rebase(lastY, FADER_FINE); }
    }, FADER_HOLD_MS);
  });
  root.addEventListener('pointermove', (e) => {
    if(!dragging || e.pointerId !== activeId) return;
    lastX = e.clientX; lastY = e.clientY; lastEventAt = performance.now();
    if(fineTimer && Math.hypot(lastX - downX, lastY - downY) >= 8){ clearTimeout(fineTimer); fineTimer = 0; }   // schon gezogen: kein Halten
    const s = sensFor(e);
    if(s !== baseSens) rebase(e.clientY, s);
    const dt = -(e.clientY - baseY) / travel() * baseSens;
    setFromUser(snap(baseT + dt, baseSens < 1));
  });
  const end = (e) => {
    if(!dragging || (e && e.pointerId !== undefined && e.pointerId !== activeId)) return;
    dragging = false; activeId = null; fineHold = false;
    clearTimeout(fineTimer); fineTimer = 0;
    root.classList.remove('active', 'fine');
    fire('change');
    // Doppeltippen mit dem Finger = 0 dB (bei der Maus übernimmt das der normale Doppelklick)
    if(e && e.type === 'pointerup' && (e.pointerType === 'touch' || e.pointerType === 'pen')){
      const now = performance.now();
      const tap = now - downAt < 300 && Math.hypot(e.clientX - downX, e.clientY - downY) < 10;
      if(tap && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40){
        lastTap.t = 0;
        root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      } else if(tap) lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', (e) => { if(dragging && e.pointerId === activeId) end(e); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());       // langes Drücken soll kein Menü öffnen

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    setFromUser(value - e.deltaY * (e.shiftKey ? 0.00006 : 0.0003));
    clearTimeout(root._wheelTimer);
    root._wheelTimer = setTimeout(() => fire('change'), 150);
  }, { passive: false });
  root.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.002 : 0.01;
    let handled = true;
    if(e.key === 'ArrowUp' || e.key === 'ArrowRight') setFromUser(value + step);
    else if(e.key === 'ArrowDown' || e.key === 'ArrowLeft') setFromUser(value - step);
    else if(e.key === 'PageUp') setFromUser(value + 0.05);
    else if(e.key === 'PageDown') setFromUser(value - 0.05);
    else if(e.key === 'Home') setFromUser(1);
    else if(e.key === 'End') setFromUser(0);
    else handled = false;
    if(handled){ e.preventDefault(); fire('change'); }
  });

  // wie ein Eingabefeld: .value lesen/setzen (Setzen löst kein "input" aus)
  Object.defineProperty(root, 'value', {
    get: () => String(value),
    set: (v) => { const n = parseFloat(v); if(!isNaN(n)){ value = clamp01(n); paint(); } },
  });
  root.isDragging = () => dragging;
  // für Tests: Bildschirm-Höhe (clientY) zu einem Fader-Wert t (Kappenmitte)
  root.yForT = (t) => { const r = track.getBoundingClientRect(); return r.top + (1 - t) * r.height; };
  root.capElement = cap;
  root.bubbleElement = bubble;
  paint();
  return root;
}
