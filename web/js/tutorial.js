// Interactive first-night tutorial (new career games): a coach panel that watches what the
// player actually does and advances on its own — from heading out to posting the first image.
import { h, toast } from './wm.js';
import { G, on, save, addMoney } from './state.js';
import * as S from './session.js';
import { isFieldVisible } from './field.js';
import { rigInfo } from './gear.js';

const GIFT = 1000;
const lightsTonight = () => (G.s.night ? G.s.frames.filter((f) => f.session === G.s.night.id && f.type === 'light').length : 0);
const flag = (k) => !!(G.s.tutorial && G.s.tutorial.flags[k]);

const STEPS = [
  { id: 'welcome', title: 'Welcome to First Light', manual: 'Let’s go',
    text: 'Tonight you’ll take, edit and post your very first astrophoto with an old DSLR, a kit lens and a tripod. This panel will guide you — it moves on by itself when you’ve done each step.' },
  { id: 'headout', title: 'Head out tonight', app: 'weather',
    text: 'Open the <b>Weather</b> app (cloud icon in the dock) and click <b>Head out tonight → Your backyard</b>. Your first night is guaranteed clear.',
    done: () => G.s.mode === 'night' },
  { id: 'cap', title: 'Take the lens cap off',
    text: 'You’re outside next to your camera on its tripod. <b>Click</b> the view to look around (Esc frees the mouse) and walk with <b>W A S D</b>. Look at the front of the lens and press <b>E</b>.',
    done: () => G.s.night && !G.s.night.capOn },
  { id: 'aim', title: 'Point the camera at the sky',
    text: 'Look at the camera and press <b>E</b> to loosen the ball head — now the camera follows your gaze. Look <b>high up</b> (at least 45°), away from the house and street light, and press <b>E</b> again to lock it.',
    done: () => { const p = S.pointing(); return p && p.alt > 45 && !document.querySelector('.field-root.grabbing'); } },
  { id: 'sit', title: 'Sit down at the laptop',
    text: 'Walk to the camping table and press <b>E</b> on the laptop (or press <b>Tab</b>).',
    done: () => !isFieldVisible() },
  { id: 'connect', title: 'Connect the camera', app: 'capture',
    text: 'Open <b>AstroCap</b> (red camera icon). In the <b>Equipment</b> tab click <b>Connect</b> next to Camera.',
    done: () => G.s.night && G.s.night.connected.camera },
  { id: 'dark', title: 'Wait for darkness',
    text: 'Stars only show up once it’s dark. Click <b>60×</b> in the time-warp control in the top bar and wait until the status says <b>Dark</b> (or Nautical twilight). Then set it back to <b>1×</b> or <b>5×</b>.',
    done: () => G.s.night && S.envAt(G.s.time).sunAlt < -12 },
  { id: 'focus', title: 'Focus the lens', skip: true,
    text: 'In AstroCap → <b>Imaging</b>: set <b>View</b> to “1:1 center crop (focus)”, Exposure <b>2</b> s, click <b>⟳ Loop</b>. Press <b>Tab</b> to go outside, press <b>R</b> and turn the <b>focus ring</b> (⟲ 2° clicks) until the stars are tiny points and the <b>HFR</b> under the laptop mirror is smallest. Lenses focus a few degrees <i>before</i> the ∞ stop.',
    done: () => { if (!G.s.night) return false; const ri = rigInfo(G.s.rig); const cfz = 4.88 * 0.55 * (ri.fstop || 4) ** 2; return Math.abs(S.focusDeltaUm()) < Math.max(25, cfz * 1.5); } },
  { id: 'shoot', title: 'Shoot 10 frames', app: 'capture',
    text: 'Stop the Loop and set <b>View</b> back to <b>Full frame</b> (crops aren’t saved). Exposure <b>10</b> s, ISO <b>1600</b>, type a target name such as “Milky Way”. Then click <b>● Capture</b> ten times — or use the <b>Sequencer</b> (Light, 10 s, count 10, ▶ Start). 20× warp speeds it up. <span class="tut-count"></span>',
    done: () => lightsTonight() >= 10, progress: () => `${Math.min(10, lightsTonight())}/10 saved` },
  { id: 'home', title: 'Pack up and go home', app: 'weather',
    text: 'Great haul! Open <b>Weather</b> and click <b>Pack up &amp; go home</b>. You’ll process the frames at home.',
    done: () => G.s.mode === 'day' },
  { id: 'stack', title: 'Stack your frames', app: 'stacker',
    text: 'Open <b>DeepStack</b> (teal stacked icon). Click your light-frame group on the left, then <b>▶ Register &amp; stack</b>. Averaging many frames makes the noise drop — 10 frames cut it by about 3×.',
    done: () => flag('stacked') },
  { id: 'edit', title: 'Edit the image', app: 'pixellab',
    text: '<b>PixelLab</b> opened with your stack. Click <b>Auto stretch</b>, nudge <b>Saturation</b> up, try a little <b>Noise reduction</b>, then click <b>💾 Save final image</b>.',
    done: () => flag('final') },
  { id: 'post', title: 'Post it', app: 'share',
    text: 'Open <b>StarShare</b> (pink star) and click <b>Publish</b> on your image. Likes — and money from prints — arrive over the next few days.',
    done: () => flag('posted') },
  { id: 'finish', title: 'Your first astrophoto! 🎉', manual: `Collect $${GIFT.toLocaleString()}`, final: true,
    text: `Ray from the astronomy club loved it and sends you <b>$${GIFT.toLocaleString()}</b> for your first real gear. Open <b>AstroMart</b>: a star tracker (Star Voyager, $380) is the biggest single upgrade — it lets you expose for minutes instead of seconds.` },
];

let panel = null, timer = null;
export function startTutorial(fresh) {
  if (fresh) G.s.tutorial = { step: 0, flags: {}, done: false };
  if (!G.s.tutorial || G.s.tutorial.done) return;
  on('stacked', () => setFlag('stacked'));
  on('final', () => setFlag('final'));
  on('posted', () => setFlag('posted'));
  render();
  clearInterval(timer); timer = setInterval(check, 500);
}
function setFlag(k) { if (G.s.tutorial) { G.s.tutorial.flags[k] = true; save(); } }
function check() {
  const t = G.s.tutorial; if (!t || t.done) return;
  const st = STEPS[t.step];
  if (st.progress) { const el = panel && panel.querySelector('.tut-count'); if (el) el.textContent = `(${st.progress()})`; }
  if (st.done && st.done()) advance();
  pulse(st.app);
}
function advance() {
  const t = G.s.tutorial; t.step = Math.min(STEPS.length - 1, t.step + 1); save(); render();
}
function finish(skipped) {
  const t = G.s.tutorial; if (!t || t.done) return;
  t.done = true; clearInterval(timer); pulse(null);
  addMoney(GIFT, skipped ? 'Starting money' : 'Gift from Ray: your first astrophoto');
  toast(skipped ? `Tutorial skipped — here’s $${GIFT.toLocaleString()} to start with. AstroMart is in the dock.` : `+$${GIFT.toLocaleString()} from Ray. Go buy some gear in AstroMart!`, 'good', 8000);
  save(true);
  if (panel) { panel.remove(); panel = null; }
}
function pulse(app) {
  document.querySelectorAll('.dock-item.tut-pulse').forEach((d) => d.classList.remove('tut-pulse'));
  if (!app) return;
  const names = { weather: 'Weather', capture: 'AstroCap', stacker: 'DeepStack', pixellab: 'PixelLab', share: 'StarShare' };
  const el = [...document.querySelectorAll('.dock-item')].find((d) => d.title === names[app]); if (el) el.classList.add('tut-pulse');
}
function render() {
  const t = G.s.tutorial; if (!t || t.done) return;
  const st = STEPS[t.step];
  if (!panel) { panel = h('div', { class: 'tut ui-av' }); document.body.append(panel); }
  panel.innerHTML = '';
  const n = STEPS.length - 1;
  panel.append(
    h('div', { class: 'tut-head' }, h('span', { class: 'lbl' }, st.final ? 'TUTORIAL COMPLETE' : t.step === 0 ? 'FIRST NIGHT TUTORIAL' : `STEP ${t.step} / ${n - 1}`), h('button', { class: 'tut-x', title: 'Skip the tutorial', onclick: () => finish(true) }, 'Skip tutorial')),
    h('div', { class: 'tut-bar' }, h('span', { style: { width: `${(t.step / n) * 100}%` } })),
    h('div', { class: 'tut-title' }, st.title),
    h('div', { class: 'tut-text', html: st.text }),
    h('div', { class: 'tut-foot' },
      st.manual ? h('button', { class: 'primary', onclick: () => (st.final ? finish(false) : advance()) }, st.manual) : h('span', { class: 'lbl tut-wait' }, 'Waiting for you…'),
      st.skip ? h('button', { onclick: () => advance() }, 'Skip this step') : null));
  check();
}
