/* Crumbfall — an incremental bakery.
 *
 * Plain script (no modules) so the game runs straight from file:// with no
 * server, no build step and no dependencies. Everything lives in one closure.
 */
(function () {
'use strict';

/* ─────────────────────────────────────────────────────────────────
 * 1. Formatting
 * ───────────────────────────────────────────────────────────────── */

var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
              'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc'];

function fmt(n, decimals) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n, decimals);
  if (n < 1000) {
    if (n === 0) return '0';
    if (n < 1) return n.toFixed(decimals == null ? 2 : decimals);
    var d = decimals == null ? (n < 100 ? 1 : 0) : decimals;
    return trimZeros(n.toFixed(d));
  }
  // `state` is still undefined while the achievement table is being built.
  if (state && state.opts && !state.opts.shorthand) {
    return Math.floor(n).toLocaleString('en-US');
  }
  var tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIX.length) return n.toExponential(2).replace('e+', 'e');
  var scaled = n / Math.pow(1000, tier);
  return trimZeros(scaled.toFixed(scaled < 10 ? 3 : scaled < 100 ? 2 : 1)) + ' ' + SUFFIX[tier];
}

function trimZeros(s) {
  return s.indexOf('.') === -1 ? s : s.replace(/\.?0+$/, '');
}

function fmtInt(n) { return Math.floor(n).toLocaleString('en-US'); }

function fmtTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return 'never';
  if (seconds < 1) return 'now';
  var units = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']];
  var parts = [];
  for (var i = 0; i < units.length && parts.length < 2; i++) {
    var v = Math.floor(seconds / units[i][0]);
    if (v > 0 || parts.length) { parts.push(v + units[i][1]); seconds -= v * units[i][0]; }
  }
  return parts.length ? parts.join(' ') : '0s';
}

/* ─────────────────────────────────────────────────────────────────
 * 2. Content
 * ───────────────────────────────────────────────────────────────── */

var COST_GROWTH = 1.15;      // each purchase makes the next one 15% dearer
var SAVE_KEY    = 'crumbfall.save.v1';
var SAVE_EVERY  = 15000;     // autosave interval, ms

var GOLDEN_MIN_MS  = 90000;  // earliest a golden cookie can appear
var GOLDEN_MAX_MS  = 300000; // latest it can appear
var GOLDEN_LIFE_MS = 14000;  // how long it waits to be clicked

var BUILDINGS = [
  { id:'cursor',   icon:'👆', name:'Nimble Cursor',      cost:15,     cps:0.1,
    flavor:'It clicks so you do not have to. Mostly.' },
  { id:'granny',   icon:'👵', name:'Grandmother',         cost:100,    cps:1,
    flavor:'Bakes from memory. Refuses to write anything down.' },
  { id:'bakery',   icon:'🏠', name:'Corner Bakery',       cost:1100,   cps:8,
    flavor:'Opens at four in the morning. Always has.' },
  { id:'farm',     icon:'🌾', name:'Dough Farm',          cost:12000,  cps:47,
    flavor:'Turns out cookies grow perfectly well in soil.' },
  { id:'factory',  icon:'🏭', name:'Cookie Factory',      cost:130000, cps:260,
    flavor:'Industrial-grade sugar, poured by the tonne.' },
  { id:'port',     icon:'🚢', name:'Crumb Port',          cost:1.4e6,  cps:1400,
    flavor:'Ships leave full of cookies and return full of butter.' },
  { id:'lab',      icon:'🧪', name:'Flavour Lab',         cost:2e7,    cps:7800,
    flavor:'They have isolated the molecule responsible for "moreish".' },
  { id:'portal',   icon:'🌀', name:'Pastry Portal',       cost:3.3e8,  cps:44000,
    flavor:'Somewhere out there is a world made entirely of dough.' },
  { id:'timex',    icon:'⏳', name:'Time Kiln',           cost:5.1e9,  cps:260000,
    flavor:'Bakes yesterday, serves today. Do not ask about tomorrow.' },
  { id:'anti',     icon:'⚛️', name:'Antimatter Oven',     cost:7.5e10, cps:1.6e6,
    flavor:'Half of every cookie annihilates. The other half is delicious.' },
  { id:'singu',    icon:'🕳️', name:'Dough Singularity',   cost:1e12,   cps:1e7,
    flavor:'Infinitely dense. Somehow still chewy.' },
  { id:'idea',     icon:'💡', name:'The Idea of a Cookie', cost:1.4e13, cps:6.5e7,
    flavor:'You do not bake it. You simply agree that it exists.' }
];

/* Legacy upgrades, bought with chips and kept forever. Chips you spend still
 * count toward the passive chip bonus, so spending is never a penalty — it is
 * the whole point of prestiging. */
var HEAVENLY = [
  { id:'hv_kit', icon:'🧺', name:'Starter Kit', cost:1,
    desc:'Begin every legacy with 1,000 cookies.',
    flavor:'A little something to get the oven warm.' },
  { id:'hv_hands', icon:'✋', name:'Blessed Hands', cost:2,
    desc:'Clicking is 50% more effective, forever.',
    flavor:'They were always good hands. Now they are certified.' },
  { id:'hv_yeast', icon:'🌾', name:'Divine Yeast', cost:4,
    desc:'+15% cookies per second, forever.',
    flavor:'It rises whether or not you are watching.' },
  { id:'hv_luck', icon:'🍀', name:'Heavenly Luck', cost:7,
    desc:'Golden cookies appear 25% more often and last 25% longer.',
    flavor:'Fortune, it turns out, can be bought.' },
  { id:'hv_aim', icon:'🎯', name:'Fated Fingers', cost:10,
    desc:'+10% critical click chance, forever.',
    flavor:'Every so often the dough simply gives up.' },
  { id:'hv_night', icon:'🌙', name:'Eternal Ovens', cost:16,
    desc:'Offline baking runs at 100%, capped at 24 hours.',
    flavor:'The ovens have never once been switched off.' },
  { id:'hv_purse', icon:'💰', name:'Inheritance', cost:25,
    desc:'Begin every legacy with 10 million cookies.',
    flavor:'Someone, somewhere, left it all to you.' },
  { id:'hv_tempo', icon:'🥁', name:'Perfect Recall', cost:35,
    desc:'Combos start at ×2 and build to ×4.',
    flavor:'Your hands remember the rhythm of every bakery you ever ran.' },
  { id:'hv_ambrosia', icon:'✨', name:'Ambrosia', cost:50,
    desc:'+40% cookies per second, forever.',
    flavor:'Strictly speaking, not a baking ingredient.' },
  { id:'hv_interest', icon:'🎖️', name:'Compound Interest', cost:80,
    desc:'Every chip gives +2.5% CpS instead of +1.5%.',
    flavor:'Your legacy earns a legacy of its own.' },
  { id:'hv_ward', icon:'🛡️', name:'Sugar Ward', cost:120,
    desc:'Golden cookies can no longer curdle.',
    flavor:'Nothing sours in here. Nothing would dare.' },
  { id:'hv_apotheosis', icon:'👑', name:'Apotheosis', cost:200,
    desc:'Double everything: CpS and clicking.',
    flavor:'You are no longer a baker. You are the reason for baking.' }
];

/* Each building gets a scene in the middle column: a strip of sky over ground,
 * populated with one sprite per unit you own. Watching the bakery physically
 * fill up is most of the fun, so these are content, not decoration.
 * The single gradient does sky and ground in one go — the hard stop is the
 * horizon. */
var SCENES = {
  cursor:  { bg: 'linear-gradient(180deg,#404a7d 0%,#5b6aa8 58%,#2c3157 58%)' },
  granny:  { bg: 'linear-gradient(180deg,#e8c9a8 0%,#dbb389 56%,#7a4f30 56%)' },
  bakery:  { bg: 'linear-gradient(180deg,#a8d4ef 0%,#cfe6f6 54%,#8d8378 54%)' },
  farm:    { bg: 'linear-gradient(180deg,#6fc3f0 0%,#a9e0f7 50%,#5fa845 50%)' },
  factory: { bg: 'linear-gradient(180deg,#c96a2a 0%,#e8a05a 48%,#4a4038 48%)' },
  port:    { bg: 'linear-gradient(180deg,#7fc9ee 0%,#bde6f8 46%,#2a6ea8 46%)' },
  lab:     { bg: 'linear-gradient(180deg,#bfe7e2 0%,#e4f5f2 52%,#9aa8a6 52%)' },
  portal:  { bg: 'linear-gradient(180deg,#6b2f9e 0%,#a94fd6 50%,#37154f 50%)' },
  timex:   { bg: 'linear-gradient(180deg,#2b2358 0%,#5c4aa8 48%,#1b1638 48%)' },
  anti:    { bg: 'linear-gradient(180deg,#0b1026 0%,#1d2a5c 46%,#070a18 46%)' },
  singu:   { bg: 'linear-gradient(180deg,#150b22 0%,#3d1a5e 44%,#050308 44%)' },
  idea:    { bg: 'linear-gradient(180deg,#f3d98a 0%,#fff4d0 50%,#c9a94f 50%)' }
};

var SCENE_SPRITE_CAP = 96;   // beyond this the row is summarised, not drawn

/* Per-building upgrade tiers — generated, so twelve buildings cost twelve lines. */
var TIERS = [
  { at:1,   name:'Reinforced',    mult:10 },
  { at:5,   name:'Refined',       mult:100 },
  { at:25,  name:'Industrial',    mult:5e3 },
  { at:50,  name:'Quantum',       mult:5e4 },
  { at:100, name:'Mythic',        mult:5e5 },
  { at:150, name:'Transcendent',  mult:5e6 }
];

/* Hand-written upgrades. `req` reads state, `apply` mutates the derived mods. */
var SPECIALS = [
  { id:'click1', icon:'🥄', name:'Steel Fingertips', cost:100,
    desc:'+1 cookie per click.', flavor:'Cutlery, sharpened for commerce.',
    req:function(s){ return s.clicks >= 10; }, apply:function(m){ m.clickFlat += 1; } },
  { id:'click2', icon:'🔧', name:'Titanium Knuckles', cost:5e3,
    desc:'Clicking is twice as effective.', flavor:'Warranty void if used on cookies.',
    req:function(s){ return s.clicks >= 100; }, apply:function(m){ m.clickMult *= 2; } },
  { id:'click3', icon:'💎', name:'Diamond Grip', cost:2e5,
    desc:'Clicking is twice as effective.', flavor:'Pressure makes both diamonds and dough.',
    req:function(s){ return s.clicks >= 500; }, apply:function(m){ m.clickMult *= 2; } },
  { id:'click4', icon:'🦾', name:'Neural Tap', cost:1e7,
    desc:'Clicking is twice as effective.', flavor:'You think about clicking. It counts.',
    req:function(s){ return s.clicks >= 2000; }, apply:function(m){ m.clickMult *= 2; } },

  { id:'hand1', icon:'🤲', name:'A Thousand Hands', cost:5e4,
    desc:'Each click also earns 1% of your cookies per second.',
    flavor:'Every cursor lends you a finger.',
    req:function(s){ return s.own.cursor >= 10; }, apply:function(m){ m.clickCps += 0.01; } },
  { id:'hand2', icon:'🙌', name:'Ten Thousand Hands', cost:1e7,
    desc:'Each click also earns 4% of your cookies per second.',
    flavor:'The bakery applauds itself.',
    req:function(s){ return s.own.cursor >= 50; }, apply:function(m){ m.clickCps += 0.04; } },
  { id:'hand3', icon:'👐', name:'A Million Hands', cost:1e10,
    desc:'Each click also earns 10% of your cookies per second.',
    flavor:'Hands all the way down.',
    req:function(s){ return s.own.cursor >= 120; }, apply:function(m){ m.clickCps += 0.10; } },

  { id:'crit1', icon:'🍀', name:'Lucky Charm', cost:2.5e5,
    desc:'+5% critical click chance.', flavor:'Found in a cereal box. Works anyway.',
    req:function(s){ return s.crits >= 10; }, apply:function(m){ m.critChance += 0.05; } },
  { id:'crit2', icon:'🎲', name:'Loaded Dice', cost:5e6,
    desc:'Critical clicks pay ×18 instead of ×10.', flavor:'Nobody checks the dice at a bakery.',
    req:function(s){ return s.crits >= 60; }, apply:function(m){ m.critMult = 18; } },
  { id:'crit3', icon:'🌟', name:'Four-Leaf Dough', cost:5e8,
    desc:'+8% critical click chance.', flavor:'Rare. Delicious. Slightly smug.',
    req:function(s){ return s.crits >= 250; }, apply:function(m){ m.critChance += 0.08; } },

  { id:'combo1', icon:'🥁', name:'Rhythm Training', cost:1e6,
    desc:'Combos build to ×3 instead of ×2.', flavor:'Steady hands, steady dough.',
    req:function(s){ return s.bestCombo >= 25; }, apply:function(m){ m.comboMax = 2; } },
  { id:'combo2', icon:'🎼', name:'Perfect Tempo', cost:5e8,
    desc:'Combos build to ×5 and decay more slowly.', flavor:'Metronome sold separately.',
    req:function(s){ return s.bestCombo >= 60; },
    apply:function(m){ m.comboMax = 4; m.comboWindow = 2.4; } },

  { id:'gold1', icon:'📡', name:'Golden Radar', cost:1e7,
    desc:'Golden cookies appear 25% more often.', flavor:'It only detects one thing. It is very good at it.',
    req:function(s){ return s.goldens >= 3; }, apply:function(m){ m.goldenRate *= 0.75; } },
  { id:'gold2', icon:'🏅', name:'Gilded Crumbs', cost:1e9,
    desc:'Golden cookie effects last 40% longer.', flavor:'Gold leaf is edible. Expensive, but edible.',
    req:function(s){ return s.goldens >= 12; }, apply:function(m){ m.goldenDur *= 1.4; } },
  { id:'gold3', icon:'👑', name:'Midas Shift', cost:1e11,
    desc:'Golden cookies appear 25% more often and effects last 40% longer.',
    flavor:'Careful what you touch.',
    req:function(s){ return s.goldens >= 40; },
    apply:function(m){ m.goldenRate *= 0.75; m.goldenDur *= 1.4; } },

  { id:'glob1', icon:'🧈', name:'Better Butter', cost:1e6,
    desc:'+10% cookies per second.', flavor:'It turns out the cheap stuff was holding you back.',
    req:function(s){ return totalBuildings(s) >= 50; }, apply:function(m){ m.cpsMult *= 1.10; } },
  { id:'glob2', icon:'📜', name:'The Master Recipe', cost:1e9,
    desc:'+20% cookies per second.', flavor:'Handwritten, water-stained, priceless.',
    req:function(s){ return totalBuildings(s) >= 150; }, apply:function(m){ m.cpsMult *= 1.20; } },
  { id:'glob3', icon:'🏛️', name:'Bakers\' Guild', cost:1e12,
    desc:'+35% cookies per second.', flavor:'Membership requires a cookie. A very good one.',
    req:function(s){ return totalBuildings(s) >= 300; }, apply:function(m){ m.cpsMult *= 1.35; } },
  { id:'glob4', icon:'🌍', name:'Global Sugar Accord', cost:1e15,
    desc:'+50% cookies per second.', flavor:'Every nation agreed. Immediately. Unanimously.',
    req:function(s){ return totalBuildings(s) >= 500; }, apply:function(m){ m.cpsMult *= 1.50; } },

  /* Synergies: one building's output scales with how many of another you own.
   * These are what turn "buy the newest thing" into an actual decision.
   * `apply` gets the live state so the bonus tracks your counts. */
  { id:'syn_granny', icon:'🍞', name:'Family Recipe', cost:5e6,
    desc:'Grandmothers gain +2% for every Corner Bakery you own.',
    flavor:'She will show you. She will not tell you.',
    req:function(s){ return s.own.granny >= 15 && s.own.bakery >= 15; },
    apply:function(m, s){ m.building.granny *= 1 + 0.02 * s.own.bakery; } },
  { id:'syn_cursor', icon:'🫱', name:'Guided Hands', cost:2e7,
    desc:'Nimble Cursors gain +3% for every Grandmother you own.',
    flavor:'Someone finally taught them where the dough is.',
    req:function(s){ return s.own.cursor >= 25 && s.own.granny >= 25; },
    apply:function(m, s){ m.building.cursor *= 1 + 0.03 * s.own.granny; } },
  { id:'syn_farm', icon:'🚜', name:'Mechanised Harvest', cost:5e8,
    desc:'Dough Farms gain +3% for every Cookie Factory you own.',
    flavor:'The fields are now a supply chain.',
    req:function(s){ return s.own.farm >= 20 && s.own.factory >= 10; },
    apply:function(m, s){ m.building.farm *= 1 + 0.03 * s.own.factory; } },
  { id:'syn_factory', icon:'⚓', name:'Just In Time', cost:2e10,
    desc:'Cookie Factories gain +4% for every Crumb Port you own.',
    flavor:'Nothing waits. Nothing is ever stored.',
    req:function(s){ return s.own.factory >= 25 && s.own.port >= 10; },
    apply:function(m, s){ m.building.factory *= 1 + 0.04 * s.own.port; } },
  { id:'syn_lab', icon:'🔬', name:'Peer Review', cost:5e11,
    desc:'Flavour Labs gain +5% for every Pastry Portal you own.',
    flavor:'The findings are consistent, reproducible and delicious.',
    req:function(s){ return s.own.lab >= 15 && s.own.portal >= 5; },
    apply:function(m, s){ m.building.lab *= 1 + 0.05 * s.own.portal; } },
  { id:'syn_all', icon:'🕸️', name:'The Whole Operation', cost:1e14,
    desc:'Every building gains +0.5% for each different type you own at least 10 of.',
    flavor:'It stopped being a bakery some time ago. Nobody noticed.',
    req:function(s){ return totalBuildings(s) >= 400; },
    apply:function(m, s){
      var kinds = 0;
      BUILDINGS.forEach(function (b) { if (s.own[b.id] >= 10) kinds++; });
      BUILDINGS.forEach(function (b) { m.building[b.id] *= 1 + 0.005 * kinds; });
    } },

  { id:'off1', icon:'🌙', name:'Night Shift', cost:1e8,
    desc:'Offline baking runs at 80% instead of 50%.',
    flavor:'Somebody has to watch the ovens.',
    req:function(s){ return s.totalEver >= 1e7; }, apply:function(m){ m.offlineRate = 0.80; } },
  { id:'off2', icon:'🛏️', name:'Bunks by the Oven', cost:1e11,
    desc:'Offline baking is capped at 12 hours instead of 3.',
    flavor:'The commute is four steps. The dough is always warm.',
    req:function(s){ return s.totalEver >= 1e10; }, apply:function(m){ m.offlineCap = 12 * 3600; } }
];

/* Bakery news. `when` gates a headline on the current state; the ones without
 * it are always in the pool. Rotated every NEWS_EVERY ms. */
var NEWS_EVERY = 12000;

var NEWS = [
  { text: 'You feel like making cookies. But nobody wants to eat your cookies.',
    when: function (s) { return totalBuildings(s) === 0; } },
  { text: 'Your first customer asks whether the cookies are "safe". You say yes.',
    when: function (s) { return totalBuildings(s) >= 1 && s.totalEver < 1e4; } },
  { text: 'Local paper runs a short piece on your bakery. It is mostly complimentary.',
    when: function (s) { return s.totalEver >= 1e4 && s.totalEver < 1e7; } },
  { text: 'Cookie futures close up four points. Nobody is quite sure why.',
    when: function (s) { return s.totalEver >= 1e7; } },
  { text: 'Economists warn of a looming shortage of adjectives for your cookies.',
    when: function (s) { return s.totalEver >= 1e10; } },
  { text: 'A minor moon has been renamed in your honour. It is chocolate now.',
    when: function (s) { return s.totalEver >= 1e13; } },
  { text: 'Physicists confirm the universe is, at large scales, faintly biscuit-flavoured.',
    when: function (s) { return s.totalEver >= 1e16; } },

  { text: 'Grandmothers seen queueing outside since dawn. None will say why.',
    when: function (s) { return s.own.granny >= 10; } },
  { text: 'Your grandmothers have started finishing each other\'s recipes.',
    when: function (s) { return s.own.granny >= 60; } },
  { text: 'Dough farm yields up 12% this season. The soil is suspiciously warm.',
    when: function (s) { return s.own.farm >= 10; } },
  { text: 'Factory inspectors declare everything "fine, probably".',
    when: function (s) { return s.own.factory >= 10; } },
  { text: 'Something came back through the pastry portal. It has been given a job.',
    when: function (s) { return s.own.portal >= 5; } },
  { text: 'Time kiln accident sends an apprentice to last Tuesday. He is fine. He was fine.',
    when: function (s) { return s.own.timex >= 5; } },
  { text: 'Antimatter oven running at nominal. Do not lick the oven.',
    when: function (s) { return s.own.anti >= 3; } },

  { text: 'Cursor union demands shorter fingers and longer breaks.',
    when: function (s) { return s.own.cursor >= 40; } },
  { text: 'Study finds clicking is good for you. Study funded by you.',
    when: function (s) { return s.clicks >= 2000; } },
  { text: 'Golden cookie sightings up sharply. Authorities advise clicking them.',
    when: function (s) { return s.goldens >= 5; } },
  { text: 'Someone has started a religion. It is about your bakery.',
    when: function (s) { return s.legacies >= 1; } },
  { text: 'Historians note this is not your first bakery, and will not be your last.',
    when: function (s) { return s.legacies >= 3; } },

  { text: 'Cookie declared the national dish of three countries and one small boat.' },
  { text: 'Nutritionists split on whether your cookies count as a food group.' },
  { text: 'Butter prices steady. Sugar prices steady. Everything is, briefly, fine.' },
  { text: 'A rival bakery opens across the street. It closes by lunchtime.' },
  { text: 'Missing: one wooden spoon. Sentimental value. No questions asked.' },
  { text: 'Health and safety would like a word about the oven. Again.' },
  { text: 'Overheard in the queue: "I only came in for a coffee."' }
];

/* Milk rises with badges. Each band renames and recolours it. */
var MILK_TIERS = [
  { at: 0.00, name: 'Plain milk',      top: '#f6efdd', bot: '#e4d8bd' },
  { at: 0.10, name: 'Chocolate milk',  top: '#a97449', bot: '#7d5330' },
  { at: 0.25, name: 'Raspberry milk',  top: '#e59aae', bot: '#c26f88' },
  { at: 0.40, name: 'Orange milk',     top: '#f0b269', bot: '#d18d3d' },
  { at: 0.55, name: 'Caramel milk',    top: '#d9a04e', bot: '#b07a2c' },
  { at: 0.70, name: 'Zebra milk',      top: '#dcd6cb', bot: '#5c554c' },
  { at: 0.85, name: 'Cosmic milk',     top: '#9d8fd6', bot: '#5b4a99' },
  { at: 0.97, name: 'Impossible milk', top: '#bff3ea', bot: '#4fbfae' }
];

/* Golden cookie effects. `weight` is relative spawn odds. */
var GOLDEN_EFFECTS = [
  { id:'frenzy', weight:36, icon:'🔥', name:'Frenzy',
    text:'Cookies per second ×7', dur:77, cpsMult:7 },
  { id:'clickfrenzy', weight:19, icon:'⚡', name:'Click Frenzy',
    text:'Clicking ×777', dur:13, clickMult:777 },
  { id:'lucky', weight:22, icon:'🍀', name:'Lucky',
    text:'A windfall of cookies', instant:true },
  { id:'bonanza', weight:8, icon:'💥', name:'Bonanza',
    text:'Cookies per second ×20', dur:22, cpsMult:20 },
  { id:'storm', weight:9, icon:'🌩️', name:'Cookie Storm',
    text:'Cookies everywhere — click them!', storm:true },
  /* The one bad outcome. Sugar Ward removes it from the pool entirely. */
  { id:'clot', weight:6, icon:'🩸', name:'Curdle', bad:true,
    text:'Cookies per second halved', dur:44, cpsMult:0.5 }
];

var STORM_COUNT   = 34;      // mini cookies flung across the screen
var STORM_LIFE_MS = 12000;

/* Achievements. Most are generated below; these are the hand-written ones. */
var ACHIEVEMENTS = [];

(function buildAchievements() {
  function add(id, icon, name, desc, test) {
    ACHIEVEMENTS.push({ id:id, icon:icon, name:name, desc:desc, test:test });
  }

  var bakeMarks = [
    [1e3,'Warm Start'], [1e6,'Local Legend'], [1e9,'Regional Power'],
    [1e12,'Confection Empire'], [1e15,'Sugar Sovereign'], [1e18,'Crumbs of Creation']
  ];
  bakeMarks.forEach(function (m, i) {
    add('bake' + i, '🍪', m[1], 'Bake ' + fmt(m[0]) + ' cookies all time.',
      function (s) { return s.totalEver >= m[0]; });
  });

  [[100,'Warmed Up'], [1000,'Persistent'], [1e4,'Repetitive Strain'], [1e5,'Unstoppable']]
    .forEach(function (m, i) {
      add('click' + i, '👆', m[1], 'Click the cookie ' + fmt(m[0]) + ' times.',
        function (s) { return s.clicks >= m[0]; });
    });

  BUILDINGS.forEach(function (b) {
    [1, 25, 100, 200].forEach(function (n) {
      add('own_' + b.id + '_' + n, b.icon,
        n === 1 ? 'First ' + b.name : b.name + ' ×' + n,
        'Own ' + n + ' ' + b.name + (n === 1 ? '.' : 's.'),
        function (s) { return s.own[b.id] >= n; });
    });
  });

  [[1,'Struck Gold'], [15,'Prospector'], [75,'Midas Regular']].forEach(function (m, i) {
    add('gold' + i, '✨', m[1], 'Click ' + m[0] + ' golden cookie' + (m[0] > 1 ? 's' : '') + '.',
      function (s) { return s.goldens >= m[0]; });
  });

  [[25,'In the Groove'], [80,'Drum Solo']].forEach(function (m, i) {
    add('combo' + i, '🥁', m[1], 'Reach a ' + m[0] + '-click combo.',
      function (s) { return s.bestCombo >= m[0]; });
  });

  [[50,'Critical Thinker'], [500,'Statistically Improbable']].forEach(function (m, i) {
    add('crit' + i, '🎯', m[1], 'Land ' + m[0] + ' critical clicks.',
      function (s) { return s.crits >= m[0]; });
  });

  [[1,'Second Bakery'], [5,'Serial Restarter'], [25,'Eternal Return']].forEach(function (m, i) {
    add('legacy' + i, '♻️', m[1], 'Start ' + m[0] + ' new legac' + (m[0] > 1 ? 'ies' : 'y') + '.',
      function (s) { return s.legacies >= m[0]; });
  });

  [[1,'Touched by Sugar'], [4,'Well Invested'], [8,'Canonised']].forEach(function (m, i) {
    add('hv' + i, '🕊️', m[1], 'Own ' + m[0] + ' legacy upgrade' + (m[0] > 1 ? 's' : '') + '.',
      function (s) {
        var n = 0;
        for (var k in s.heavenly) if (s.heavenly[k]) n++;
        return n >= m[0];
      });
  });

  [[25,'Storm Chaser'], [200,'Weathered']].forEach(function (m, i) {
    add('storm' + i, '🌩️', m[1], 'Click ' + m[0] + ' cookies during storms.',
      function (s) { return s.storms >= m[0]; });
  });

  add('syn', '🕸️', 'Vertically Integrated', 'Own every synergy upgrade.',
    function (s) {
      return ['syn_granny','syn_cursor','syn_farm','syn_factory','syn_lab','syn_all']
        .every(function (id) { return s.upgrades[id]; });
    });

  add('rate1', '📈', 'Idle Hands', 'Reach 1,000 cookies per second.',
    function (s) { return derived.cps >= 1e3; });
  add('rate2', '🚀', 'Escape Velocity', 'Reach 1,000,000 cookies per second.',
    function (s) { return derived.cps >= 1e6; });
  add('hoard', '🏦', 'Hoarder', 'Hold 1,000,000,000 cookies at once.',
    function (s) { return s.cookies >= 1e9; });
  add('broke', '🕳️', 'All In', 'Spend down to under 10 cookies while owning 100 buildings.',
    function (s) { return s.cookies < 10 && totalBuildings(s) >= 100; });
})();

/* ─────────────────────────────────────────────────────────────────
 * 3. State
 * ───────────────────────────────────────────────────────────────── */

function freshState() {
  var own = {};
  BUILDINGS.forEach(function (b) { own[b.id] = 0; });
  return {
    v: 1,
    cookies: 0,
    totalEver: 0,        // all-time baked, drives prestige chips
    runTotal: 0,         // baked this legacy
    own: own,
    upgrades: {},        // id -> true
    achievements: {},    // id -> true
    clicks: 0,
    crits: 0,
    goldens: 0,
    bestCombo: 0,
    legacies: 0,
    chips: 0,            // prestige chips earned all time (never decreases)
    chipsSpent: 0,       // of those, how many are committed to legacy upgrades
    heavenly: {},        // id -> true, permanent across legacies
    storms: 0,           // storm cookies clicked, all time
    handClicked: 0,      // cookies earned by hand this legacy
    bakery: 'Your',
    started: now(),
    playTime: 0,
    lastSave: now(),
    opts: { fx: true, sound: false, shorthand: true, confirmPrestige: true, theme: 'dark' }
  };
}

var state    = freshState();
var derived  = { cps: 0, click: 1, mods: null };
var buffs    = [];        // {id, icon, name, text, until, dur, cpsMult, clickMult}
var bulk     = 1;         // 1 | 10 | 100 | 'max' | 'sell'
var combo    = { count: 0, last: 0 };
var golden   = null;      // live DOM node
var goldenAt = 0;         // timestamp of next spawn

function now() { return Date.now(); }
function totalBuildings(s) {
  var t = 0;
  for (var i = 0; i < BUILDINGS.length; i++) t += s.own[BUILDINGS[i].id] || 0;
  return t;
}

/* ─────────────────────────────────────────────────────────────────
 * 4. Derived values
 * ───────────────────────────────────────────────────────────────── */

function baseMods() {
  var m = {
    clickFlat: 1, clickMult: 1, clickCps: 0,
    critChance: 0.05, critMult: 10,
    comboMax: 1, comboWindow: 1.6,
    goldenRate: 1, goldenDur: 1,
    cpsMult: 1, offlineRate: 0.5, offlineCap: 3 * 3600,
    chipRate: 0.015, comboFloor: 0, noClot: false,
    startCookies: 0,
    building: {}
  };
  BUILDINGS.forEach(function (b) { m.building[b.id] = 1; });
  return m;
}

function recalc() {
  var m = baseMods();

  // Per-building tier upgrades.
  BUILDINGS.forEach(function (b) {
    TIERS.forEach(function (t, ti) {
      if (state.upgrades[b.id + '_t' + ti]) m.building[b.id] *= 2;
    });
  });

  // Legacy upgrades first: some of them change how later maths behaves.
  applyHeavenly(m);

  // Special upgrades. Synergies read the live state, hence the second argument.
  SPECIALS.forEach(function (u) {
    if (state.upgrades[u.id]) u.apply(m, state);
  });

  // Badges: +0.5% CpS each.
  var badges = countAchievements();
  m.cpsMult *= 1 + badges * 0.005;

  // Legacy chips: a flat passive bonus per chip earned, spent or not.
  m.cpsMult *= 1 + state.chips * m.chipRate;
  m.clickMult *= 1 + state.chips * 0.01;

  var raw = 0;
  BUILDINGS.forEach(function (b) {
    raw += state.own[b.id] * b.cps * m.building[b.id];
  });

  var cpsBuff = 1, clickBuff = 1;
  buffs.forEach(function (bf) {
    if (bf.cpsMult) cpsBuff *= bf.cpsMult;
    if (bf.clickMult) clickBuff *= bf.clickMult;
  });

  derived.mods     = m;
  derived.baseCps  = raw * m.cpsMult;
  derived.cps      = derived.baseCps * cpsBuff;
  derived.cpsBuff  = cpsBuff;
  derived.clickBuff = clickBuff;
  // Click value shown to the player includes the combo they currently hold.
  derived.clickRaw = (m.clickFlat * m.clickMult) + derived.cps * m.clickCps;
  derived.click    = derived.clickRaw * clickBuff * comboMult();
}

/* ── Sound ────────────────────────────────────────────────────────
 * Every sound is synthesised at play time, so the game still ships as three
 * text files. Off by default — nobody wants a browser tab that starts beeping.
 * The context is created lazily on the first sound, which is always inside a
 * user gesture, so autoplay policy is satisfied. */

var Snd = { ctx: null, bus: null, dead: false };

function audioReady() {
  if (Snd.dead) return null;
  if (!Snd.ctx) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { Snd.dead = true; return null; }
    try {
      Snd.ctx = new AC();
      Snd.bus = Snd.ctx.createGain();
      Snd.bus.gain.value = 0.32;
      Snd.bus.connect(Snd.ctx.destination);
    } catch (e) { Snd.dead = true; return null; }
  }
  if (Snd.ctx.state === 'suspended') Snd.ctx.resume();
  return Snd.ctx;
}

/* One note. `slide` bends the pitch over the note's life. */
function tone(freq, dur, type, vol, delay, slide) {
  var ctx = Snd.ctx;
  var t0 = ctx.currentTime + (delay || 0);
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = type || 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  // A quick attack and an exponential tail keeps it from clicking.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol == null ? 0.5 : vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(Snd.bus);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

var SFX = {
  click:    function (n) { tone(300 + Math.min(n, 40) * 9, 0.06, 'triangle', 0.35); },
  crit:     function () { tone(520, 0.09, 'square', 0.32); tone(880, 0.13, 'square', 0.28, 0.06); },
  buy:      function () { tone(220, 0.10, 'sine', 0.5, 0, 150); tone(330, 0.09, 'triangle', 0.25, 0.03); },
  upgrade:  function () { tone(660, 0.10, 'triangle', 0.4); tone(990, 0.16, 'triangle', 0.34, 0.08); },
  golden:   function () { [784, 988, 1319].forEach(function (f, i) { tone(f, 0.16, 'triangle', 0.36, i * 0.07); }); },
  bad:      function () { tone(180, 0.32, 'sawtooth', 0.3, 0, 70); },
  storm:    function () { tone(1100 + Math.random() * 500, 0.05, 'sine', 0.22); },
  badge:    function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, 'triangle', 0.32, i * 0.08); }); },
  prestige: function () { [262, 330, 392, 523].forEach(function (f, i) { tone(f, 0.5, 'sine', 0.34, i * 0.13); }); }
};

function sfx(name, arg) {
  if (!state || !state.opts || !state.opts.sound) return;
  if (!audioReady()) return;
  var fn = SFX[name];
  if (fn) { try { fn(arg); } catch (e) { /* never let audio break the game */ } }
}

function hasHeavenly(id) { return !!state.heavenly[id]; }

function chipsAvailable() { return Math.max(0, state.chips - state.chipsSpent); }

function applyHeavenly(m) {
  if (hasHeavenly('hv_kit'))     m.startCookies = Math.max(m.startCookies, 1e3);
  if (hasHeavenly('hv_hands'))   m.clickMult *= 1.5;
  if (hasHeavenly('hv_yeast'))   m.cpsMult *= 1.15;
  if (hasHeavenly('hv_luck'))  { m.goldenRate *= 0.75; m.goldenDur *= 1.25; }
  if (hasHeavenly('hv_aim'))     m.critChance += 0.10;
  if (hasHeavenly('hv_night')) { m.offlineRate = 1; m.offlineCap = 24 * 3600; }
  if (hasHeavenly('hv_purse'))   m.startCookies = Math.max(m.startCookies, 1e7);
  if (hasHeavenly('hv_tempo')) { m.comboFloor = 1; m.comboMax = Math.max(m.comboMax, 3); }
  if (hasHeavenly('hv_ambrosia')) m.cpsMult *= 1.4;
  if (hasHeavenly('hv_interest')) m.chipRate = 0.025;
  if (hasHeavenly('hv_ward'))    m.noClot = true;
  if (hasHeavenly('hv_apotheosis')) { m.cpsMult *= 2; m.clickMult *= 2; }
}

function buyHeavenly(h) {
  if (state.heavenly[h.id] || h.cost > chipsAvailable()) return;
  state.chipsSpent += h.cost;
  state.heavenly[h.id] = true;
  recalc();
  checkAchievements();
  sfx('upgrade');
  ui.invalidate();
  ui.paintAll();
  ui.toast(h.icon, h.name, h.desc);
}

function comboMult() {
  var m = derived.mods || baseMods();
  var cap = 50;
  return 1 + m.comboFloor + Math.min(combo.count, cap) / cap * m.comboMax;
}

function countAchievements() {
  var n = 0;
  for (var k in state.achievements) if (state.achievements[k]) n++;
  return n;
}

/* Cost of the next `count` copies of a building, given `owned` already. */
function bulkCost(base, owned, count) {
  var first = base * Math.pow(COST_GROWTH, owned);
  return first * (Math.pow(COST_GROWTH, count) - 1) / (COST_GROWTH - 1);
}

/* Largest `count` affordable with `cookies`. */
function maxAffordable(base, owned, cookies) {
  var first = base * Math.pow(COST_GROWTH, owned);
  if (!(cookies >= first)) return 0;
  var n = Math.floor(
    Math.log(cookies * (COST_GROWTH - 1) / first + 1) / Math.log(COST_GROWTH)
  );
  if (!isFinite(n) || n < 0) return 0;
  // Nudge across float drift at the boundary; the closed form is never far off,
  // so the bound is a paranoia check rather than a real loop limit.
  var guard = 64;
  while (n > 0 && bulkCost(base, owned, n) > cookies && guard--) n--;
  guard = 64;
  while (bulkCost(base, owned, n + 1) <= cookies && guard--) n++;
  return n;
}

function buyCount(b) {
  if (bulk === 'sell') return 1;
  if (bulk === 'max') return Math.max(1, maxAffordable(b.cost, state.own[b.id], state.cookies));
  return bulk;
}

/* Selling refunds half of what the copies cost. */
function sellValue(b, count) {
  var owned = state.own[b.id];
  count = Math.min(count, owned);
  if (count <= 0) return 0;
  return bulkCost(b.cost, owned - count, count) * 0.5;
}

/* ─────────────────────────────────────────────────────────────────
 * 5. Upgrade catalogue
 * ───────────────────────────────────────────────────────────────── */

function allUpgrades() {
  var out = [];
  BUILDINGS.forEach(function (b) {
    TIERS.forEach(function (t, ti) {
      out.push({
        id: b.id + '_t' + ti,
        icon: b.icon,
        name: t.name + ' ' + b.name,
        desc: b.name + 's are twice as productive.',
        flavor: b.flavor,
        cost: b.cost * t.mult,
        req: (function (b, t) {
          return function (s) { return s.own[b.id] >= t.at; };
        })(b, t)
      });
    });
  });
  return out.concat(SPECIALS);
}

var UPGRADES = allUpgrades();

function availableUpgrades() {
  return UPGRADES.filter(function (u) {
    return !state.upgrades[u.id] && u.req(state);
  }).sort(function (a, b) { return a.cost - b.cost; });
}

/* ─────────────────────────────────────────────────────────────────
 * 6. Actions
 * ───────────────────────────────────────────────────────────────── */

function earn(amount, countsAsBaked) {
  state.cookies += amount;
  if (countsAsBaked !== false) {
    state.totalEver += amount;
    state.runTotal += amount;
  }
}

function clickCookie(x, y) {
  var t = now();
  var m = derived.mods;
  var window_ = m.comboWindow * 1000;

  if (t - combo.last < window_) combo.count++;
  else combo.count = 1;
  combo.last = t;
  if (combo.count > state.bestCombo) state.bestCombo = combo.count;

  recalc();

  var value = derived.click;
  var crit = Math.random() < m.critChance;
  if (crit) { value *= m.critMult; state.crits++; }

  earn(value);
  state.clicks++;
  state.handClicked += value;

  sfx(crit ? 'crit' : 'click', combo.count);
  ui.pop(x, y, '+' + fmt(value), crit ? 'is-crit' : '');
  ui.cookiePress(crit);
  if (crit) ui.crumbs(x, y, 14);
  else ui.crumbs(x, y, 5);

  checkAchievements();
  ui.paintClickStats();
}

function buyBuilding(b) {
  if (bulk === 'sell') {
    if (state.own[b.id] <= 0) return;
    var refund = sellValue(b, 1);
    state.own[b.id]--;
    earn(refund, false);        // refunds are not "baked" cookies
    recalc(); ui.paintAll();
    return;
  }
  var n = buyCount(b);
  var cost = bulkCost(b.cost, state.own[b.id], n);
  if (cost > state.cookies || n <= 0) return;
  state.cookies -= cost;
  state.own[b.id] += n;
  recalc();
  checkAchievements();
  sfx('buy');
  ui.paintAll();
}

function buyUpgrade(u) {
  if (state.upgrades[u.id] || u.cost > state.cookies || !u.req(state)) return;
  state.cookies -= u.cost;
  state.upgrades[u.id] = true;
  recalc();
  checkAchievements();
  sfx('upgrade');
  ui.paintAll();
}

/* Prestige. Chips scale with the cube root of all-time cookies, so each one
 * costs meaningfully more than the last. */
function chipsFor(totalEver) {
  return Math.floor(Math.cbrt(totalEver / 1e9));
}

function pendingChips() {
  return Math.max(0, chipsFor(state.totalEver) - state.chips);
}

function doPrestige() {
  var gain = pendingChips();
  if (gain <= 0) return;

  var keep = {
    totalEver: state.totalEver,
    achievements: state.achievements,
    clicks: state.clicks,
    crits: state.crits,
    goldens: state.goldens,
    storms: state.storms,
    bestCombo: state.bestCombo,
    legacies: state.legacies + 1,
    bakery: state.bakery,
    chips: state.chips + gain,
    chipsSpent: state.chipsSpent,
    heavenly: state.heavenly,
    started: state.started,
    playTime: state.playTime,
    opts: state.opts
  };
  var fresh = freshState();
  for (var k in keep) fresh[k] = keep[k];
  state = fresh;

  buffs = [];
  combo = { count: 0, last: 0 };
  clearGolden();
  clearStorm();
  scheduleGolden();
  recalc();
  // Starter Kit / Inheritance seed the new bakery. Not counted as baked, so
  // they cannot bootstrap the next prestige.
  if (derived.mods.startCookies > 0) {
    earn(derived.mods.startCookies, false);
  }
  recalc();
  checkAchievements();
  save();
  sfx('prestige');
  ui.invalidate();
  ui.paintAll();
  ui.toast('♻️', 'A new legacy begins', '+' + fmt(gain) + ' chip' + (gain > 1 ? 's' : '') +
    ' — now ' + fmt(state.chips) + ' total.');
}

/* ─────────────────────────────────────────────────────────────────
 * 7. Golden cookies & buffs
 * ───────────────────────────────────────────────────────────────── */

function scheduleGolden() {
  var m = derived.mods || baseMods();
  var span = GOLDEN_MAX_MS - GOLDEN_MIN_MS;
  var delay = (GOLDEN_MIN_MS + Math.random() * span) * m.goldenRate;
  goldenAt = now() + delay;
}

function spawnGolden() {
  if (golden) return;
  var layer = el.goldenLayer;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'golden';
  btn.textContent = '🌟';
  btn.setAttribute('aria-label', 'Golden cookie — click for a bonus');
  // Viewport coordinates — the layer is fixed, so the cookie is always on
  // screen no matter how far the page has scrolled or how tall the bakery is.
  var size = 76;                                   // roughly the button's box
  var bar = document.querySelector('.topbar');     // never spawn under the header
  var topGuard = (bar ? bar.getBoundingClientRect().height : 72) + 12;
  var maxX = Math.max(0, window.innerWidth  - size - 16);
  var maxY = Math.max(0, window.innerHeight - size - 16);
  btn.style.left = (16 + Math.random() * Math.max(0, maxX - 16)) + 'px';
  btn.style.top  = (topGuard + Math.random() * Math.max(0, maxY - topGuard)) + 'px';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    collectGolden(btn);
  });
  layer.appendChild(btn);
  golden = { node: btn, expires: now() + GOLDEN_LIFE_MS };
}

/* Cookie Storm: a screenful of small cookies, each worth a slice of your
 * production. Rare, brief, and the only effect you have to work for. */
var storm = [];

function startStorm() {
  clearStorm();
  var value = Math.max(derived.cps * 8, 15);
  for (var i = 0; i < STORM_COUNT; i++) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'storm-cookie';
    b.textContent = '🍪';
    b.style.left = (2 + Math.random() * 92) + '%';
    b.style.fontSize = (26 + Math.random() * 20) + 'px';
    // Slow enough to catch, and the last one arrives well inside the window —
    // a cookie you cannot reach is just a tease.
    b.style.animationDuration = (3.8 + Math.random() * 2.6).toFixed(2) + 's';
    b.style.animationDelay = (Math.random() * 3.4).toFixed(2) + 's';
    b.setAttribute('aria-label', 'Storm cookie');
    b.addEventListener('click', (function (node) {
      return function (e) {
        e.stopPropagation();
        if (node.dataset.taken) return;
        node.dataset.taken = '1';
        var r = node.getBoundingClientRect();
        earn(value);
        state.storms++;
        sfx('storm');
        ui.pop(r.left + r.width / 2, r.top, '+' + fmt(value), 'is-gold');
        if (node.parentNode) node.parentNode.removeChild(node);
      };
    })(b));
    el.goldenLayer.appendChild(b);
    storm.push(b);
  }
  setTimeout(clearStorm, STORM_LIFE_MS);
}

function clearStorm() {
  storm.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
  storm = [];
}

function clearGolden() {
  if (golden && golden.node.parentNode) golden.node.parentNode.removeChild(golden.node);
  golden = null;
}

function pickEffect() {
  var pool = GOLDEN_EFFECTS.filter(function (e) {
    return !(e.bad && derived.mods && derived.mods.noClot);
  });
  var total = pool.reduce(function (a, e) { return a + e.weight; }, 0);
  var roll = Math.random() * total;
  for (var i = 0; i < pool.length; i++) {
    roll -= pool[i].weight;
    if (roll <= 0) return pool[i];
  }
  return pool[0];
}

function collectGolden(node) {
  var rect = node.getBoundingClientRect();
  var x = rect.left + rect.width / 2;
  var y = rect.top + rect.height / 2;

  clearGolden();
  state.goldens++;
  scheduleGolden();

  var fx = pickEffect();
  var m = derived.mods;

  if (fx.storm) {
    startStorm();
    sfx('golden');
    ui.pop(x, y, fx.name + '!', 'is-gold');
    ui.toast(fx.icon, fx.name, 'Click every cookie you can reach.');
  } else if (fx.instant) {
    // A windfall: 15% of the bank, or 15 minutes of production — whichever is
    // kinder — plus a floor so it is never insulting early on.
    var amount = Math.max(state.cookies * 0.15, derived.cps * 900, 25);
    earn(amount);
    sfx('golden');
    ui.pop(x, y, '+' + fmt(amount), 'is-gold');
    ui.toast(fx.icon, fx.name, '+' + fmt(amount) + ' cookies.');
  } else {
    var dur = fx.dur * m.goldenDur;
    addBuff({
      id: fx.id, icon: fx.icon, name: fx.name, text: fx.text,
      dur: dur, until: now() + dur * 1000,
      cpsMult: fx.cpsMult, clickMult: fx.clickMult, bad: fx.bad
    });
    sfx(fx.bad ? 'bad' : 'golden');
    ui.pop(x, y, fx.name + '!', fx.bad ? 'is-bad' : 'is-gold');
    ui.toast(fx.icon, fx.name, fx.text + ' for ' + Math.round(dur) + 's.');
  }

  ui.crumbs(x, y, 20, true);
  checkAchievements();
  recalc();
  ui.paintAll();
}

function addBuff(b) {
  // Re-collecting the same effect extends it rather than stacking it.
  var existing = buffs.filter(function (x) { return x.id === b.id; })[0];
  if (existing) { existing.until = Math.max(existing.until, b.until); return; }
  buffs.push(b);
}

function tickBuffs() {
  var t = now();
  var before = buffs.length;
  buffs = buffs.filter(function (b) { return b.until > t; });
  if (buffs.length !== before) recalc();
}

/* ─────────────────────────────────────────────────────────────────
 * 8. Achievements
 * ───────────────────────────────────────────────────────────────── */

/* `silent` is used on load: an imported save can satisfy a dozen badges at once,
 * and burying the screen in toasts you never earned in front of us is noise. */
function checkAchievements(silent) {
  var announced = 0;
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    var a = ACHIEVEMENTS[i];
    if (state.achievements[a.id]) continue;
    var ok = false;
    try { ok = a.test(state); } catch (e) { ok = false; }
    if (ok) {
      state.achievements[a.id] = true;
      // Even in play, a burst (say, a Lucky payout crossing three thresholds)
      // gets summarised rather than queued four deep.
      if (!silent && announced < 3) {
        ui.toast(a.icon, a.name, a.desc);
        if (!announced) sfx('badge');
        announced++;
      }
      recalc();
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
 * 9. Save / load
 * ───────────────────────────────────────────────────────────────── */

function save() {
  state.lastSave = now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;   // private browsing, quota, etc. — never break the game over it
  }
}

function loadRaw(text) {
  var data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('not a save');
  var fresh = freshState();

  // Merge defensively: unknown keys are dropped, missing keys keep defaults.
  ['cookies', 'totalEver', 'runTotal', 'clicks', 'crits', 'goldens', 'storms',
   'bestCombo', 'legacies', 'chips', 'chipsSpent', 'handClicked', 'playTime',
   'started', 'lastSave'].forEach(function (k) {
    if (typeof data[k] === 'number' && isFinite(data[k])) fresh[k] = data[k];
  });
  if (data.own) BUILDINGS.forEach(function (b) {
    var v = data.own[b.id];
    if (typeof v === 'number' && isFinite(v) && v >= 0) fresh.own[b.id] = Math.floor(v);
  });
  if (data.upgrades) UPGRADES.forEach(function (u) {
    if (data.upgrades[u.id]) fresh.upgrades[u.id] = true;
  });
  if (data.achievements) ACHIEVEMENTS.forEach(function (a) {
    if (data.achievements[a.id]) fresh.achievements[a.id] = true;
  });
  if (data.heavenly) HEAVENLY.forEach(function (h) {
    if (data.heavenly[h.id]) fresh.heavenly[h.id] = true;
  });
  if (typeof data.bakery === 'string' && data.bakery.trim()) {
    fresh.bakery = data.bakery.slice(0, 24);
  }
  if (data.opts) {
    ['fx', 'sound', 'shorthand', 'confirmPrestige'].forEach(function (k) {
      if (typeof data.opts[k] === 'boolean') fresh.opts[k] = data.opts[k];
    });
    if (data.opts.theme === 'light' || data.opts.theme === 'dark') fresh.opts.theme = data.opts.theme;
  }
  // Chips can never exceed what the all-time total justifies, and spending can
  // never exceed the legacy upgrades actually owned.
  fresh.chips = Math.min(fresh.chips, chipsFor(fresh.totalEver));
  var owed = 0;
  HEAVENLY.forEach(function (h) { if (fresh.heavenly[h.id]) owed += h.cost; });
  fresh.chipsSpent = Math.min(owed, fresh.chips);
  return fresh;
}

function load() {
  var text;
  try { text = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!text) return false;
  try {
    state = loadRaw(text);
    return true;
  } catch (e) {
    console.warn('Crumbfall: save could not be read, starting fresh.', e);
    return false;
  }
}

function applyOfflineProgress() {
  recalc();
  var m = derived.mods;
  var away = (now() - state.lastSave) / 1000;
  if (away < 60 || derived.baseCps <= 0) return;

  var counted = Math.min(away, m.offlineCap);
  var earned = derived.baseCps * counted * m.offlineRate;
  if (earned < 1) return;

  earn(earned);
  el.offlineTime.textContent = fmtTime(away);
  el.offlineEarned.textContent = '+' + fmt(earned) + ' cookies';
  el.offlineRate.textContent =
    'Counted ' + fmtTime(counted) + ' at ' + Math.round(m.offlineRate * 100) + '% of ' +
    fmt(derived.baseCps) + '/s' +
    (away > counted ? ' — the rest was past the ' + fmtTime(m.offlineCap) + ' cap.' : '.');
  try { el.offlineDlg.showModal(); } catch (e) { /* dialog unsupported */ }
}

/* ─────────────────────────────────────────────────────────────────
 * 10. DOM
 * ───────────────────────────────────────────────────────────────── */

var EL_IDS = [
  'cookieCount','cpsCount','cpsBuffTag','buffBar','stage','fx','goldenLayer','bigCookie',
  'clickValue','critChance','comboValue','comboFill','comboBox','chipsOwned','chipBonus',
  'prestigeBtn','prestigeNote','buildingList','upgradeList','upgradeEmpty','achievementList',
  'achCount','statList','toasts','settings','offlineDlg','offlineTime',
  'offlineEarned','offlineRate','optFx','optShort','optConfirm','exportBtn','importBtn',
  'wipeBtn','saveBox','saveStatus','themeBtn','tipbox',
  'bakeryName','newsText','milk','milkFill','milkLabel',
  'sceneList','sceneEmpty','cookieRain',
  'heavenlyList','chipBank','chipSpent','hvCount','soundBtn','optSound','sparkWrap'
];

/* Populated in boot(), so this file can also be required headlessly by the
 * self-test without a DOM present. */
var el = {};
function cacheEls() {
  EL_IDS.forEach(function (id) { el[id] = document.getElementById(id); });
}

var ui = {};

/* --- Effects ------------------------------------------------------ */

ui.pop = function (x, y, text, cls) {
  if (!state.opts.fx) return;
  var n = document.createElement('div');
  n.className = 'float ' + (cls || '');
  n.textContent = text;
  n.style.left = x + 'px';
  n.style.top = y + 'px';
  el.fx.appendChild(n);
  setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000);
};

ui.crumbs = function (x, y, count, gold) {
  if (!state.opts.fx) return;
  if (el.fx.childElementCount > 90) return;   // cheap overload guard
  for (var i = 0; i < count; i++) {
    var c = document.createElement('div');
    c.className = 'crumb';
    c.style.left = x + 'px';
    c.style.top = y + 'px';
    if (gold) c.style.background = 'var(--gold)';
    var angle = Math.random() * Math.PI * 2;
    var dist = 40 + Math.random() * 90;
    c.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    c.style.setProperty('--dy', (Math.sin(angle) * dist + 60) + 'px');
    c.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
    el.fx.appendChild(c);
    (function (node) {
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 850);
    })(c);
  }
};

ui.cookiePress = function (crit) {
  var c = el.bigCookie;
  c.classList.remove('pressed', 'crit');
  void c.offsetWidth;                   // restart the animation
  c.classList.add(crit ? 'crit' : 'pressed');
  setTimeout(function () { c.classList.remove('pressed'); }, 90);
};

/* Tooltips. One shared fixed-position box, so a tile in the top row of the
 * store isn't clipped by the panel's own scroll container. */
var tipTarget = null;

ui.showTip = function (target) {
  var d = target._tip;
  if (!d) return;
  var box = el.tipbox;
  tipTarget = target;

  box.textContent = '';
  function line(cls, text) {
    if (!text) return;
    var n = document.createElement(cls === 'name' ? 'b' : 'span');
    if (cls !== 'name') n.className = cls;
    n.textContent = text;
    box.appendChild(n);
  }
  line('name', d.name);
  line('tip-desc', d.desc);
  if (d.cost) {
    var c = document.createElement('span');
    c.className = 'tip-cost' + (d.cant ? ' cant' : '');
    c.textContent = d.cost;
    box.appendChild(c);
  }
  line('tip-state', d.state);
  line('tip-flavor', d.flavor);

  box.hidden = false;
  var r = target.getBoundingClientRect();
  var b = box.getBoundingClientRect();
  var left = r.left + r.width / 2 - b.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
  var top = r.top - b.height - 10;
  if (top < 8) top = r.bottom + 10;                       // no room above: flip
  top = Math.min(top, window.innerHeight - b.height - 8);
  box.style.left = Math.round(left) + 'px';
  box.style.top = Math.round(top) + 'px';
};

ui.hideTip = function (target) {
  if (target && target !== tipTarget) return;
  tipTarget = null;
  el.tipbox.hidden = true;
};

ui.toast = function (icon, title, sub) {
  var n = document.createElement('div');
  n.className = 'toast';
  n.innerHTML = '<span class="toast-icon"></span><span><span class="toast-title"></span>' +
                '<br><span class="toast-sub"></span></span>';
  n.querySelector('.toast-icon').textContent = icon;
  n.querySelector('.toast-title').textContent = title;
  n.querySelector('.toast-sub').textContent = sub || '';
  el.toasts.appendChild(n);
  setTimeout(function () {
    n.classList.add('out');
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
  }, 4200);
  while (el.toasts.childElementCount > 4) el.toasts.removeChild(el.toasts.firstChild);
};

/* --- Headline ----------------------------------------------------- */

ui.paintHeader = function () {
  el.cookieCount.textContent = fmt(state.cookies);
  el.cpsCount.textContent = fmt(derived.cps);
  if (derived.cpsBuff > 1) {
    el.cpsBuffTag.hidden = false;
    el.cpsBuffTag.textContent = '×' + fmt(derived.cpsBuff, 0);
  } else {
    el.cpsBuffTag.hidden = true;
  }
  document.title = fmt(state.cookies) + ' cookies — Crumbfall';
};

ui.paintClickStats = function () {
  el.clickValue.textContent = fmt(derived.click);
  el.critChance.textContent = Math.round(derived.mods.critChance * 100) + '%';
  var cm = comboMult();
  el.comboValue.textContent = '×' + cm.toFixed(2);
  var cap = 50;
  var pct = Math.min(combo.count, cap) / cap * 100;
  el.comboFill.style.width = pct + '%';
  el.comboBox.classList.toggle('hot', combo.count >= 10);
};

ui.paintBuffs = function () {
  var t = now();
  el.buffBar.textContent = '';
  buffs.forEach(function (b) {
    var left = Math.max(0, (b.until - t) / 1000);
    var d = document.createElement('div');
    d.className = 'buff' + (b.bad ? ' is-bad' : '');
    d.innerHTML = '<span class="buff-icon"></span><span class="buff-name"></span>' +
                  '<span class="buff-time"></span><span class="buff-life"></span>';
    d.querySelector('.buff-icon').textContent = b.icon;
    d.querySelector('.buff-name').textContent = b.text;
    d.querySelector('.buff-time').textContent = Math.ceil(left) + 's';
    d.querySelector('.buff-life').style.transform = 'scaleX(' + (left / b.dur) + ')';
    el.buffBar.appendChild(d);
  });
};

/* --- Building scenes ---------------------------------------------- */

var sceneSig = null;

ui.paintScenes = function () {
  var sig = BUILDINGS.map(function (b) { return state.own[b.id]; }).join(',');
  if (sig === sceneSig) return;
  sceneSig = sig;

  el.sceneList.textContent = '';
  var any = false;

  BUILDINGS.forEach(function (b) {
    var owned = state.own[b.id];
    if (owned <= 0) return;
    any = true;

    var row = document.createElement('div');
    row.className = 'scene';
    row.style.background = (SCENES[b.id] || {}).bg || 'linear-gradient(180deg,#555,#222)';

    var label = document.createElement('span');
    label.className = 'scene-label';
    label.textContent = b.name + ' ×' + fmt(owned, 0);
    row.appendChild(label);

    var pen = document.createElement('div');
    pen.className = 'scene-sprites';
    var drawn = Math.min(owned, SCENE_SPRITE_CAP);
    for (var i = 0; i < drawn; i++) {
      var s = document.createElement('span');
      s.className = 'sprite';
      s.textContent = b.icon;
      // Stagger the bob so the row never marches in lockstep.
      s.style.setProperty('--d', (-(i % 17) * 0.13).toFixed(2) + 's');
      pen.appendChild(s);
    }
    row.appendChild(pen);

    if (owned > drawn) {
      var more = document.createElement('span');
      more.className = 'scene-more';
      more.textContent = '+' + fmt(owned - drawn, 0) + ' more';
      row.appendChild(more);
    }

    row.setAttribute('aria-label', owned + ' ' + b.name + (owned === 1 ? '' : 's'));
    el.sceneList.appendChild(row);
  });

  el.sceneEmpty.hidden = any;
};

/* --- News ticker -------------------------------------------------- */

var cpsHistory = [];
var cpsSampleAt = 0;
var CPS_SAMPLES = 72;          // ~6 minutes at one sample every 5s

function sampleCps() {
  var t = now();
  if (t - cpsSampleAt < 5000) return;
  cpsSampleAt = t;
  cpsHistory.push(derived.cps);
  if (cpsHistory.length > CPS_SAMPLES) cpsHistory.shift();
}

/* A log-scaled sparkline, because production spans many orders of magnitude
 * over a session and a linear plot would be a flat line then a cliff. */
function sparkline(values, w, h) {
  if (values.length < 2) return null;
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  // Stretch to the panel width instead of letterboxing inside it.
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');

  var logs = values.map(function (v) { return Math.log10(Math.max(v, 1)); });
  var lo = Math.min.apply(null, logs), hi = Math.max.apply(null, logs);
  var span = (hi - lo) || 1;
  var pts = logs.map(function (v, i) {
    var x = i / (logs.length - 1) * w;
    var y = h - 2 - (v - lo) / span * (h - 4);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  var area = document.createElementNS(svg.namespaceURI, 'polygon');
  area.setAttribute('points', '0,' + h + ' ' + pts + ' ' + w + ',' + h);
  area.setAttribute('class', 'spark-area');
  var line = document.createElementNS(svg.namespaceURI, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('class', 'spark-line');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(area);
  svg.appendChild(line);
  return svg;
}

var newsAt = 0;
var lastNews = '';

ui.paintNews = function (force) {
  var t = now();
  if (!force && t - newsAt < NEWS_EVERY) return;
  newsAt = t;

  var pool = NEWS.filter(function (n) {
    return (!n.when || n.when(state)) && n.text !== lastNews;
  });
  if (!pool.length) return;

  var pick = pool[Math.floor(Math.random() * pool.length)];
  lastNews = pick.text;
  el.newsText.textContent = pick.text;
  // Restart the fade-in.
  el.newsText.style.animation = 'none';
  void el.newsText.offsetWidth;
  el.newsText.style.animation = '';
};

/* --- Milk --------------------------------------------------------- */

ui.paintMilk = function () {
  var pct = ACHIEVEMENTS.length ? countAchievements() / ACHIEVEMENTS.length : 0;
  var tier = MILK_TIERS[0];
  for (var i = 0; i < MILK_TIERS.length; i++) {
    if (pct >= MILK_TIERS[i].at) tier = MILK_TIERS[i];
  }
  el.milkFill.style.height = (14 + pct * 86) + '%';
  el.milkFill.style.setProperty('--milk-top', tier.top);
  el.milkFill.style.setProperty('--milk-bot', tier.bot);
  el.milkLabel.textContent = tier.name + ' — ' + Math.round(pct * 100) + '%';
  el.milk.title = tier.name + '. Milk rises as you earn badges (' +
    countAchievements() + ' of ' + ACHIEVEMENTS.length + ').';
};

var heavenlySig = null;

ui.paintHeavenly = function () {
  var avail = chipsAvailable();
  var owned = 0;
  HEAVENLY.forEach(function (h) { if (state.heavenly[h.id]) owned++; });
  var sig = avail + '/' + owned;
  if (sig === heavenlySig) return;
  heavenlySig = sig;

  el.chipBank.textContent = fmt(avail, 0);
  el.chipSpent.textContent = fmt(state.chipsSpent, 0);
  el.hvCount.textContent = owned + ' / ' + HEAVENLY.length + ' owned';

  el.heavenlyList.textContent = '';
  ui.hideTip();

  HEAVENLY.forEach(function (h) {
    var have = !!state.heavenly[h.id];
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'up hv' + (have ? ' owned' : '');
    btn.disabled = have || h.cost > avail;
    btn.textContent = h.icon;
    btn._tip = {
      name: h.name,
      desc: h.desc,
      cost: have ? null : h.cost + ' chip' + (h.cost === 1 ? '' : 's'),
      cant: h.cost > avail,
      state: have ? 'Owned — kept through every legacy' : '',
      flavor: h.flavor
    };
    btn.setAttribute('aria-label',
      (have ? 'Owned: ' : '') + h.name + ' — ' + h.desc +
      (have ? '' : ' — costs ' + h.cost + ' chips'));
    btn.addEventListener('click', function () { buyHeavenly(h); });
    li.appendChild(btn);
    el.heavenlyList.appendChild(li);
  });
};

ui.paintLegacy = function () {
  var pending = pendingChips();
  el.chipsOwned.textContent = fmt(chipsAvailable(), 0) + ' / ' + fmt(state.chips, 0) + ' chips';
  var rate = (derived.mods ? derived.mods.chipRate : 0.015) * 100;
  el.chipBonus.textContent = '+' + (state.chips * rate).toFixed(1) + '%';
  el.prestigeBtn.disabled = pending <= 0;
  el.prestigeBtn.textContent = pending > 0
    ? 'Start a new legacy (+' + fmt(pending) + ' chip' + (pending === 1 ? '' : 's') + ')'
    : 'Bake a new legacy';

  if (pending > 0) {
    el.prestigeNote.textContent =
      'Resets cookies, buildings and upgrades. Badges, chips and stats stay.';
  } else {
    var need = Math.pow(state.chips + 1, 3) * 1e9;
    el.prestigeNote.textContent =
      'Next chip at ' + fmt(need) + ' all-time cookies (' +
      fmt(state.totalEver) + ' so far).';
  }
};

/* --- Buildings ---------------------------------------------------- */

var buildingNodes = {};

ui.buildBuildings = function () {
  el.buildingList.textContent = '';
  buildingNodes = {};
  BUILDINGS.forEach(function (b) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.innerHTML =
      '<span class="item-icon"></span>' +
      '<span class="item-mid"><span class="item-name"></span><span class="item-sub"></span></span>' +
      '<span class="item-right"><span class="item-cost"></span>' +
      '<span class="item-count"></span><span class="item-eta"></span></span>';
    btn.querySelector('.item-icon').textContent = b.icon;
    btn.addEventListener('click', function () { buyBuilding(b); });
    li.appendChild(btn);
    el.buildingList.appendChild(li);
    buildingNodes[b.id] = {
      li: li, btn: btn,
      name: btn.querySelector('.item-name'),
      sub: btn.querySelector('.item-sub'),
      cost: btn.querySelector('.item-cost'),
      count: btn.querySelector('.item-count'),
      eta: btn.querySelector('.item-eta')
    };
  });
};

/* A building is revealed once it's owned or half-affordable — plus one teaser
 * beyond the deepest revealed one, so there is always something to save for. */
function revealDepth() {
  var deepest = -1;
  for (var i = 0; i < BUILDINGS.length; i++) {
    var b = BUILDINGS[i];
    if (state.own[b.id] > 0 || state.totalEver >= b.cost * 0.5) deepest = i;
  }
  return Math.min(deepest + 1, BUILDINGS.length - 1);
}

ui.paintBuildings = function () {
  var m = derived.mods;
  var depth = revealDepth();

  BUILDINGS.forEach(function (b, i) {
    var n = buildingNodes[b.id];
    var owned = state.own[b.id];

    if (i > depth) { n.li.hidden = true; return; }
    n.li.hidden = false;

    var selling = bulk === 'sell';
    var count = buyCount(b);
    var each = b.cps * m.building[b.id] * m.cpsMult;

    if (selling) {
      var refund = sellValue(b, 1);
      n.name.textContent = 'Sell ' + b.name;
      n.cost.textContent = '+' + fmt(refund);
      n.cost.classList.remove('cant');
      n.btn.disabled = owned <= 0;
      n.eta.textContent = 'half refund';
    } else {
      var cost = bulkCost(b.cost, owned, count);
      var afford = cost <= state.cookies;
      n.name.textContent = b.name + (count > 1 ? ' ×' + count : '');
      n.cost.textContent = fmt(cost);
      n.cost.classList.toggle('cant', !afford);
      n.btn.disabled = !afford;
      n.eta.textContent = afford ? 'ready'
        : derived.cps > 0 ? 'in ' + fmtTime((cost - state.cookies) / derived.cps)
        : '—';
    }

    n.btn._tip = {
      name: b.name,
      desc: fmt(b.cps * m.building[b.id] * m.cpsMult) + ' cookies per second each' +
        (owned ? ', ' + fmt(owned * each) + '/s from your ' + fmt(owned, 0) : ''),
      cost: selling ? null : fmt(bulkCost(b.cost, owned, count)) + ' cookies' +
        (bulkCost(b.cost, owned, count) > state.cookies && derived.cps > 0
          ? ' · ' + fmtTime((bulkCost(b.cost, owned, count) - state.cookies) / derived.cps)
          : ''),
      cant: !selling && bulkCost(b.cost, owned, count) > state.cookies,
      flavor: b.flavor
    };

    n.count.textContent = owned ? fmt(owned, 0) : '';
    var share = derived.baseCps > 0 ? (owned * each / derived.baseCps * 100) : 0;
    // A big bakery makes early buildings a rounding error; don't print "0%".
    var shareText = share >= 1 ? share.toFixed(0) + '%'
                  : share >= 0.1 ? share.toFixed(1) + '%'
                  : '<0.1%';
    n.sub.textContent = fmt(each) + '/s each' +
      (owned ? ' · ' + fmt(owned * each) + '/s total (' + shareText + ')' : '');
  });
};

/* --- Upgrades ----------------------------------------------------- */

var upgradeSig = null;

ui.paintUpgrades = function () {
  var list = availableUpgrades();

  // Rebuilding sixteen times a second would yank the node out from under the
  // cursor, so only redraw when the offer or its affordability actually moves.
  var sig = list.map(function (u) {
    return u.id + (u.cost <= state.cookies ? '+' : '-');
  }).join(',');
  if (sig === upgradeSig) return;
  upgradeSig = sig;

  el.upgradeList.textContent = '';
  el.upgradeEmpty.hidden = list.length > 0;
  ui.hideTip();

  list.forEach(function (u) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'up';
    btn.disabled = u.cost > state.cookies;
    btn.textContent = u.icon;

    var short = u.cost > state.cookies;
    btn._tip = {
      name: u.name,
      desc: u.desc,
      cost: fmt(u.cost) + ' cookies' +
        (short && derived.cps > 0
          ? ' · ' + fmtTime((u.cost - state.cookies) / derived.cps)
          : ''),
      cant: short,
      flavor: u.flavor
    };
    btn.setAttribute('aria-label', u.name + ' — ' + u.desc + ' — ' + fmt(u.cost) + ' cookies');
    btn.addEventListener('click', function () { buyUpgrade(u); });

    li.appendChild(btn);
    el.upgradeList.appendChild(li);
  });

};

/* --- Achievements ------------------------------------------------- */

var achievementSig = null;

ui.paintAchievements = function () {
  var got = countAchievements();
  if (got === achievementSig) return;      // only changes when one is earned
  achievementSig = got;

  el.achievementList.textContent = '';
  ui.hideTip();
  el.achCount.textContent = got + ' / ' + ACHIEVEMENTS.length + ' earned — currently +' +
    (got * 0.5).toFixed(1) + '% CpS.';

  ACHIEVEMENTS.forEach(function (a) {
    var unlocked = !!state.achievements[a.id];
    var li = document.createElement('li');
    var d = document.createElement('div');
    d.className = 'up' + (unlocked ? ' owned' : ' locked');
    d.tabIndex = 0;
    d.textContent = unlocked ? a.icon : '🔒';

    d._tip = {
      name: a.name,
      desc: a.desc,
      state: unlocked ? 'Earned — +0.5% cookies per second' : ''
    };
    d.setAttribute('aria-label', (unlocked ? 'Earned: ' : 'Locked: ') + a.name + ' — ' + a.desc);

    li.appendChild(d);
    el.achievementList.appendChild(li);
  });
};

/* --- Stats -------------------------------------------------------- */

ui.paintStats = function () {
  var m = derived.mods;
  var rows = [
    ['head', 'This legacy'],
    ['Cookies in the bank', fmt(state.cookies)],
    ['Baked this legacy', fmt(state.runTotal)],
    ['Cookies per second', fmt(derived.cps)],
    ['Buildings owned', fmtInt(totalBuildings(state))],
    ['Upgrades bought', fmtInt(Object.keys(state.upgrades).length)],

    ['Storm cookies caught', fmtInt(state.storms)],

    ['head', 'All time'],
    ['Cookies baked', fmt(state.totalEver)],
    ['Baked by hand', fmt(state.handClicked)],
    ['Cookie clicks', fmtInt(state.clicks)],
    ['Critical clicks', fmtInt(state.crits) +
      ' (' + (state.clicks ? (state.crits / state.clicks * 100).toFixed(1) : '0') + '%)'],
    ['Best combo', fmtInt(state.bestCombo) + ' clicks'],
    ['Golden cookies', fmtInt(state.goldens)],
    ['Legacies started', fmtInt(state.legacies)],
    ['Legacy chips', fmtInt(state.chips) + ' earned, ' + fmtInt(state.chipsSpent) + ' spent'],
    ['Legacy upgrades', (function () {
      var n = 0;
      HEAVENLY.forEach(function (h) { if (state.heavenly[h.id]) n++; });
      return n + ' / ' + HEAVENLY.length;
    })()],
    ['Badges', countAchievements() + ' / ' + ACHIEVEMENTS.length],
    ['Time played', fmtTime(state.playTime)],

    ['head', 'Current multipliers'],
    ['Per click', fmt(derived.click)],
    ['Critical chance', Math.round(m.critChance * 100) + '% for ×' + m.critMult],
    ['Combo ceiling', '×' + (1 + m.comboMax).toFixed(2)],
    ['Global CpS bonus', '×' + m.cpsMult.toFixed(3)],
    ['Active buff bonus', '×' + derived.cpsBuff.toFixed(2)],
    ['Offline baking', Math.round(m.offlineRate * 100) + '%, capped at ' + fmtTime(m.offlineCap)]
  ];

  // Production over the last few minutes, log-scaled.
  el.sparkWrap.textContent = '';
  var chart = sparkline(cpsHistory, 300, 54);
  if (chart) {
    el.sparkWrap.appendChild(chart);
    var cap = document.createElement('p');
    cap.className = 'spark-cap';
    cap.textContent = 'Cookies per second, last ' +
      fmtTime(cpsHistory.length * 5) + ' — now ' + fmt(derived.cps) + '/s';
    el.sparkWrap.appendChild(cap);
  }

  el.statList.textContent = '';
  rows.forEach(function (r) {
    if (r[0] === 'head') {
      var h = document.createElement('dt');
      h.className = 'head';
      h.textContent = r[1];
      el.statList.appendChild(h);
      return;
    }
    var dt = document.createElement('dt'); dt.textContent = r[0];
    var dd = document.createElement('dd'); dd.textContent = r[1];
    el.statList.appendChild(dt);
    el.statList.appendChild(dd);
  });
};

/* --- Whole-store repaint ------------------------------------------ */

var activeTab = 'bakery';

/* Call whenever `state` is swapped wholesale or number formatting changes —
 * the cached signatures above would otherwise skip a needed redraw. */
ui.invalidate = function () {
  upgradeSig = null;
  achievementSig = null;
  sceneSig = null;
  heavenlySig = null;
  ui.hideTip();
};

ui.paintAll = function () {
  ui.paintHeader();
  ui.paintClickStats();
  ui.paintLegacy();
  ui.paintBuildings();
  ui.paintUpgrades();
  ui.paintScenes();
  ui.paintMilk();
  ui.paintHeavenly();
  if (activeTab === 'achievements') ui.paintAchievements();
  if (activeTab === 'stats') ui.paintStats();
};

/* ─────────────────────────────────────────────────────────────────
 * 11. Wiring
 * ───────────────────────────────────────────────────────────────── */

/* Cycles ×1 → ×10 → ×100 → Max → Sell and back, keeping the buttons in sync. */
function cycleBulk() {
  var order = ['1', '10', '100', 'max', 'sell'];
  var cur = String(bulk);
  var next = order[(order.indexOf(cur) + 1) % order.length];
  var btn = document.querySelector('.bulk-btn[data-bulk="' + next + '"]');
  if (btn) btn.click();
}

function cookieClickHandler(e) {
  var x, y;
  if (e && typeof e.clientX === 'number' && e.clientX !== 0) {
    x = e.clientX;
    y = e.clientY;
  } else {
    var cr = el.bigCookie.getBoundingClientRect();
    x = cr.left + cr.width / 2;
    y = cr.top + cr.height / 2;
  }
  clickCookie(x, y);
}

function wire() {
  el.bigCookie.addEventListener('click', cookieClickHandler);

  // Space / Enter while the cookie is focused already fires click; this adds a
  // global Space shortcut without hijacking typing or other buttons.
  document.addEventListener('keydown', function (e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;

    if (e.code === 'Space') {
      // Space on a focused button already activates it; don't double-fire.
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault();
      cookieClickHandler(null);
      return;
    }

    // 1-9 buy the nth revealed building, 0 the tenth.
    if (/^(Digit|Numpad)[0-9]$/.test(e.code)) {
      var n = parseInt(e.code.slice(-1), 10);
      var idx = n === 0 ? 9 : n - 1;
      var visible = BUILDINGS.filter(function (b, i) { return i <= revealDepth(); });
      if (visible[idx]) { e.preventDefault(); buyBuilding(visible[idx]); }
      return;
    }

    if (e.code === 'KeyB') { e.preventDefault(); cycleBulk(); return; }
    if (e.code === 'KeyM') { e.preventDefault(); setSound(!state.opts.sound); return; }
  });

  // Tooltips, delegated on the document so they work for every tile —
  // upgrades and buildings in the store, badges and legacy upgrades in the
  // middle column — and survive any panel repaint.
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest ? e.target.closest('.up, .item') : null;
    if (t) ui.showTip(t);
  });
  document.addEventListener('mouseout', function (e) {
    var t = e.target.closest ? e.target.closest('.up, .item') : null;
    if (t) ui.hideTip(t);
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target.closest ? e.target.closest('.up, .item') : null;
    if (t) ui.showTip(t); else ui.hideTip();
  });
  document.addEventListener('focusout', function () { ui.hideTip(); });
  // A scroll moves the anchor out from under a tip that is already placed.
  document.addEventListener('scroll', function () { ui.hideTip(); }, true);

  // Tabs
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      activeTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('.tabpanel').forEach(function (p) {
        p.hidden = p.dataset.panel !== activeTab;
      });
      ui.paintAll();
    });
  });

  // Bulk buttons
  document.querySelectorAll('.bulk-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.dataset.bulk;
      bulk = (v === 'max' || v === 'sell') ? v : parseInt(v, 10);
      document.querySelectorAll('.bulk-btn').forEach(function (o) {
        o.classList.toggle('active', o === b);
      });
      ui.paintBuildings();
    });
  });

  // Prestige
  el.prestigeBtn.addEventListener('click', function () {
    var gain = pendingChips();
    if (gain <= 0) return;
    if (state.opts.confirmPrestige) {
      var ok = confirm(
        'Start a new legacy?\n\n' +
        'You gain ' + fmt(gain) + ' legacy chip' + (gain === 1 ? '' : 's') +
        ' (+' + (gain * 1.5).toFixed(1) + '% cookies per second, forever).\n\n' +
        'You lose: your cookies, every building and every upgrade.\n' +
        'You keep: badges, chips, and all your stats.'
      );
      if (!ok) return;
    }
    doPrestige();
  });

  // Settings
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var dlg = document.getElementById(b.dataset.open);
      if (dlg && dlg.showModal) dlg.showModal();
    });
  });

  el.optFx.addEventListener('change', function () {
    state.opts.fx = el.optFx.checked;
    document.body.classList.toggle('no-fx', !state.opts.fx);
  });
  el.optShort.addEventListener('change', function () {
    state.opts.shorthand = el.optShort.checked;
    ui.invalidate();
    ui.paintAll();
  });
  el.optConfirm.addEventListener('change', function () {
    state.opts.confirmPrestige = el.optConfirm.checked;
  });

  el.bakeryName.addEventListener('input', function () {
    state.bakery = el.bakeryName.value.slice(0, 24);
  });
  el.bakeryName.addEventListener('blur', function () {
    if (!state.bakery.trim()) state.bakery = 'Your';
    el.bakeryName.value = state.bakery;
    save();
  });
  el.bakeryName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') el.bakeryName.blur();
  });

  el.optSound.addEventListener('change', function () {
    setSound(el.optSound.checked);
  });
  el.soundBtn.addEventListener('click', function () { setSound(!state.opts.sound); });

  el.themeBtn.addEventListener('click', function () {
    state.opts.theme = state.opts.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  el.exportBtn.addEventListener('click', function () {
    save();
    el.saveBox.hidden = false;
    el.saveBox.value = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    el.saveBox.select();
    el.saveStatus.textContent = 'Copy this text somewhere safe.';
  });

  el.importBtn.addEventListener('click', function () {
    if (el.saveBox.hidden) {
      el.saveBox.hidden = false;
      el.saveBox.value = '';
      el.saveBox.focus();
      el.saveStatus.textContent = 'Paste an exported save, then press Import again.';
      return;
    }
    var text = el.saveBox.value.trim();
    if (!text) { el.saveStatus.textContent = 'Nothing to import.'; return; }
    try {
      var json = text.charAt(0) === '{' ? text : decodeURIComponent(escape(atob(text)));
      var loaded = loadRaw(json);
      state = loaded;
      buffs = []; combo = { count: 0, last: 0 };
      clearGolden(); clearStorm(); scheduleGolden();
      applyOpts(); applyTheme(); recalc(); checkAchievements(true);
      ui.invalidate(); ui.paintAll(); save();
      el.saveStatus.textContent = 'Save imported.';
      el.saveBox.hidden = true;
    } catch (e) {
      el.saveStatus.textContent = 'That does not look like a Crumbfall save.';
    }
  });

  el.wipeBtn.addEventListener('click', function () {
    if (!confirm('Delete your save and start over from nothing? This cannot be undone.')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    state = freshState();
    buffs = []; combo = { count: 0, last: 0 };
    clearGolden(); clearStorm(); scheduleGolden();
    applyOpts(); applyTheme(); recalc(); ui.invalidate(); ui.paintAll();
    el.saveStatus.textContent = 'Save deleted.';
  });

  window.addEventListener('beforeunload', function () {
    state.lastSave = now();
    save();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) save();
  });
}

function buildCookieRain() {
  el.cookieRain.textContent = '';
  for (var i = 0; i < 9; i++) {
    var c = document.createElement('span');
    c.className = 'rain-cookie';
    c.textContent = '🍪';
    c.style.left = (2 + i * 11 + Math.random() * 6) + '%';
    c.style.fontSize = (14 + Math.random() * 14) + 'px';
    c.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + 's';
    c.style.animationDelay = (-Math.random() * 14).toFixed(1) + 's';
    c.style.setProperty('--spin', Math.round(Math.random() * 500 - 250) + 'deg');
    el.cookieRain.appendChild(c);
  }
}

function setSound(on) {
  state.opts.sound = !!on;
  applySound();
  if (on) sfx('upgrade');     // confirms it works, and unlocks the context
  save();
}

function applySound() {
  el.optSound.checked = state.opts.sound;
  el.soundBtn.textContent = state.opts.sound ? '🔊' : '🔇';
  el.soundBtn.setAttribute('aria-pressed', state.opts.sound ? 'true' : 'false');
  el.soundBtn.setAttribute('aria-label', state.opts.sound ? 'Turn sound off' : 'Turn sound on');
}

function applyOpts() {
  el.bakeryName.value = state.bakery;
  applySound();
  el.optFx.checked = state.opts.fx;
  el.optShort.checked = state.opts.shorthand;
  el.optConfirm.checked = state.opts.confirmPrestige;
  document.body.classList.toggle('no-fx', !state.opts.fx);
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.opts.theme);
  el.themeBtn.textContent = state.opts.theme === 'dark' ? '🌗' : '🌞';
}

/* ─────────────────────────────────────────────────────────────────
 * 12. Loop
 * ───────────────────────────────────────────────────────────────── */

var lastFrame = now();
var lastPaint = 0;
var lastSaveAt = now();

function frame() {
  var t = now();
  var dt = Math.min((t - lastFrame) / 1000, 1);   // clamp after a tab stall
  lastFrame = t;

  state.playTime += dt;

  tickBuffs();

  // Combo decays once you stop clicking.
  if (combo.count > 0 && t - combo.last > derived.mods.comboWindow * 1000) {
    combo.count = 0;
    recalc();
  }

  if (derived.cps > 0) earn(derived.cps * dt);

  // Golden cookies.
  if (!golden && t >= goldenAt) spawnGolden();
  if (golden && t > golden.expires) { clearGolden(); scheduleGolden(); }

  if (t - lastPaint > 60) {
    lastPaint = t;
    checkAchievements();
    ui.paintHeader();
    ui.paintClickStats();
    sampleCps();
    ui.paintBuffs();
    ui.paintNews();
    ui.paintLegacy();
    ui.paintBuildings();
    ui.paintUpgrades();
    ui.paintScenes();
    ui.paintMilk();
    if (activeTab === 'stats') ui.paintStats();
    if (activeTab === 'achievements') ui.paintAchievements();
  }

  if (t - lastSaveAt > SAVE_EVERY) { lastSaveAt = t; save(); }

  requestAnimationFrame(frame);
}

/* ─────────────────────────────────────────────────────────────────
 * 13. Boot
 * ───────────────────────────────────────────────────────────────── */

function boot() {
  cacheEls();
  var had = load();
  applyOpts();
  applyTheme();
  recalc();
  if (had) applyOfflineProgress();
  recalc();
  checkAchievements(true);
  ui.buildBuildings();
  buildCookieRain();
  ui.paintNews(true);
  ui.paintAll();
  ui.paintAchievements();
  wire();
  scheduleGolden();
  lastFrame = now();
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

/* Exposed for the headless self-test (`node game.test.js`). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fmt: fmt, fmtTime: fmtTime, bulkCost: bulkCost, maxAffordable: maxAffordable,
    chipsFor: chipsFor, freshState: freshState, loadRaw: loadRaw,
    BUILDINGS: BUILDINGS, UPGRADES: UPGRADES, ACHIEVEMENTS: ACHIEVEMENTS,
    HEAVENLY: HEAVENLY, SPECIALS: SPECIALS, GOLDEN_EFFECTS: GOLDEN_EFFECTS,
    SCENES: SCENES, NEWS: NEWS, MILK_TIERS: MILK_TIERS,
    COST_GROWTH: COST_GROWTH,
    _setState: function (s) { state = s; },
    _getState: function () { return state; }
  };
}

})();
