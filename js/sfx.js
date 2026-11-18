// Sound effects, synthesized with the Web Audio API (no audio files, no dependencies). Exposes window.NeuralSfx.
// The AudioContext is created lazily on the first sound, which always follows a click, so browsers allow it.
(() => {
  let ac = null, master = null, enabled = true, lastHover = 0;

  function ctx() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain();
    master.gain.value = 0.22;
    master.connect(comp).connect(ac.destination);
    return ac;
  }

  // One enveloped oscillator: quick attack, exponential decay, optional pitch glide.
  function tone({ freq, to = freq, type = 'sine', at = 0, dur = 0.12, vol = 0.5, attack = 0.005 }) {
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Band-passed noise swept from `from` to `to` Hz: a soft whoosh.
  let noiseBuf = null;
  function whoosh({ from = 300, to = 2400, dur = 0.7, vol = 0.35 }) {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime, src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(from * 1.5, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // Each node type gets its own note (a pentatonic scale), so selections sound related but distinct.
  const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
  const TYPES = ['core', 'hub', 'memory', 'note', 'skill', 'hook', 'mod', 'mcp', 'agent', 'model', 'reference', 'section', 'project', 'group'];
  const noteFor = (type) => SCALE[Math.max(0, TYPES.indexOf(type)) % SCALE.length];

  const SOUNDS = {
    tap: () => tone({ freq: 1400, to: 900, dur: 0.05, vol: 0.18, type: 'triangle' }),
    hover: (n) => tone({ freq: noteFor(n && n.type) * 2, dur: 0.06, vol: 0.05 }),
    select: (n) => {
      const f = noteFor(n && n.type);
      tone({ freq: f, dur: 0.5, vol: 0.32 });
      tone({ freq: f * 1.5, at: 0.06, dur: 0.6, vol: 0.2 });
      tone({ freq: f * 3, at: 0.06, dur: 0.25, vol: 0.05 });
    },
    close: () => tone({ freq: 700, to: 380, dur: 0.16, vol: 0.16, type: 'triangle' }),
    morph: () => { whoosh({}); tone({ freq: 196, to: 261.6, dur: 0.8, vol: 0.12, attack: 0.2 }); },
    on: () => { tone({ freq: 660, dur: 0.1, vol: 0.2 }); tone({ freq: 990, at: 0.07, dur: 0.16, vol: 0.18 }); },
  };

  // Browsers only let audio start after a gesture; until then stay silent (no console warnings, no queued sounds).
  let unlocked = false;
  const unlock = () => { unlocked = true; };
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { once: true, capture: true });

  function play(name, arg) {
    if (!enabled || !unlocked || !SOUNDS[name]) return;
    if (name === 'hover') { const now = performance.now(); if (now - lastHover < 70) return; lastHover = now; }
    try { if (ctx()) SOUNDS[name](arg); } catch { /* audio unavailable */ }
  }
  function setEnabled(on) { enabled = !!on; if (enabled) play('on'); }

  window.NeuralSfx = { play, setEnabled, get enabled() { return enabled; } };
})();
