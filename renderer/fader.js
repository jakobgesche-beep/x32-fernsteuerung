// Pult-Fader: langer Schlitz, breite Kappe mit Farbstrich, dB-Skala.
// Der Wert ist die Pult-Position 0..1 (X32-"level"-Wert, 0.75 = 0 dB), verhält sich nach außen
// wie ein Schieberegler: .value lesen/setzen, "input" beim Ändern, "change" beim Loslassen.
const FADER_TICKS = [[10, '+10'], [5, '+5'], [0, '0'], [-5, '-5'], [-10, '-10'], [-20, '-20'], [-30, '-30'], [-40, '-40'], [-60, '-60'], [-90, 'oo']];
const FADER_UNITY = 0.75;

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
  root.appendChild(scale);
  root.appendChild(track);
  root.appendChild(cap);

  let value = 0, dragging = false, baseY = 0, baseT = 0, baseFine = false;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function paint(){
    root.style.setProperty('--t', value);
    const db = value <= 0 ? -90 : X32V.faderToDb(value);
    root.setAttribute('aria-valuenow', db.toFixed(1));
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
  // leichtes Einrasten bei 0 dB (mit Shift für Feineinstellung deaktiviert)
  const snap = (t, fine) => (!fine && Math.abs(t - FADER_UNITY) < 0.007 ? FADER_UNITY : t);

  root.addEventListener('pointerdown', (e) => {
    if(e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    root.focus({ preventScroll: true });
    dragging = true;
    try { root.setPointerCapture(e.pointerId); } catch(err){}
    if(!cap.contains(e.target)) setFromUser(snap(tFromY(e.clientY), e.shiftKey));   // Klick in den Schlitz: Kappe springt hin
    baseY = e.clientY; baseT = value; baseFine = !!e.shiftKey;
    root.classList.add('active');
  });
  root.addEventListener('pointermove', (e) => {
    if(!dragging) return;
    if(!!e.shiftKey !== baseFine){ baseFine = !!e.shiftKey; baseY = e.clientY; baseT = value; }   // Feinmodus wechselt: neu ansetzen
    const dt = -(e.clientY - baseY) / travel() * (baseFine ? 0.2 : 1);
    setFromUser(snap(baseT + dt, baseFine));
  });
  const end = () => {
    if(!dragging) return;
    dragging = false;
    root.classList.remove('active');
    fire('change');
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

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
  paint();
  return root;
}
