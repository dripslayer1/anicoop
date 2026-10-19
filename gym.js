/* global sb, siteFetch */
/* anicoop Gym (v1.7.0): workouts with progressive overload, routines + a weekly plan, food & macros, body weight,
   and a few tools. Everything is saved in your account (tables gym_*, only you can see them; supabase/v1.7.0-gym.sql).
   Loaded before app.js, which registers it as <gym-section>. `sb` and `siteFetch` come from app.js (used at run time). */

// ---------- exercises: [name, muscle, equipment, kind] · kind: w = weight × reps, bw = bodyweight (+ added kg), t = seconds, c = cardio (km + min)
const GYM_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Forearms', 'Cardio'];
const GYM_EXERCISES = [
    ['Bench press', 'Chest', 'Barbell'], ['Incline bench press', 'Chest', 'Barbell'], ['Decline bench press', 'Chest', 'Barbell'],
    ['Dumbbell bench press', 'Chest', 'Dumbbell'], ['Incline dumbbell press', 'Chest', 'Dumbbell'], ['Dumbbell fly', 'Chest', 'Dumbbell'],
    ['Cable fly', 'Chest', 'Cable'], ['Pec deck', 'Chest', 'Machine'], ['Chest press machine', 'Chest', 'Machine'],
    ['Push-up', 'Chest', 'Bodyweight', 'bw'], ['Dips', 'Chest', 'Bodyweight', 'bw'],
    ['Deadlift', 'Back', 'Barbell'], ['Pull-up', 'Back', 'Bodyweight', 'bw'], ['Chin-up', 'Back', 'Bodyweight', 'bw'],
    ['Lat pulldown', 'Back', 'Cable'], ['Barbell row', 'Back', 'Barbell'], ['Dumbbell row', 'Back', 'Dumbbell'],
    ['Seated cable row', 'Back', 'Cable'], ['T-bar row', 'Back', 'Barbell'], ['Chest-supported row', 'Back', 'Machine'],
    ['Straight-arm pulldown', 'Back', 'Cable'], ['Rack pull', 'Back', 'Barbell'], ['Back extension', 'Back', 'Bodyweight', 'bw'], ['Shrug', 'Back', 'Dumbbell'],
    ['Overhead press', 'Shoulders', 'Barbell'], ['Seated dumbbell press', 'Shoulders', 'Dumbbell'], ['Arnold press', 'Shoulders', 'Dumbbell'],
    ['Shoulder press machine', 'Shoulders', 'Machine'], ['Lateral raise', 'Shoulders', 'Dumbbell'], ['Cable lateral raise', 'Shoulders', 'Cable'],
    ['Front raise', 'Shoulders', 'Dumbbell'], ['Rear delt fly', 'Shoulders', 'Dumbbell'], ['Reverse pec deck', 'Shoulders', 'Machine'],
    ['Face pull', 'Shoulders', 'Cable'], ['Upright row', 'Shoulders', 'Barbell'],
    ['Barbell curl', 'Biceps', 'Barbell'], ['EZ-bar curl', 'Biceps', 'Barbell'], ['Dumbbell curl', 'Biceps', 'Dumbbell'], ['Hammer curl', 'Biceps', 'Dumbbell'],
    ['Preacher curl', 'Biceps', 'Machine'], ['Incline dumbbell curl', 'Biceps', 'Dumbbell'], ['Cable curl', 'Biceps', 'Cable'], ['Concentration curl', 'Biceps', 'Dumbbell'],
    ['Triceps pushdown', 'Triceps', 'Cable'], ['Overhead triceps extension', 'Triceps', 'Cable'], ['Skull crusher', 'Triceps', 'Barbell'],
    ['Close-grip bench press', 'Triceps', 'Barbell'], ['Triceps kickback', 'Triceps', 'Dumbbell'], ['Bench dips', 'Triceps', 'Bodyweight', 'bw'],
    ['Squat', 'Quads', 'Barbell'], ['Front squat', 'Quads', 'Barbell'], ['Leg press', 'Quads', 'Machine'], ['Hack squat', 'Quads', 'Machine'],
    ['Bulgarian split squat', 'Quads', 'Dumbbell'], ['Lunge', 'Quads', 'Dumbbell'], ['Leg extension', 'Quads', 'Machine'], ['Goblet squat', 'Quads', 'Dumbbell'],
    ['Romanian deadlift', 'Hamstrings', 'Barbell'], ['Lying leg curl', 'Hamstrings', 'Machine'], ['Seated leg curl', 'Hamstrings', 'Machine'],
    ['Good morning', 'Hamstrings', 'Barbell'], ['Nordic curl', 'Hamstrings', 'Bodyweight', 'bw'],
    ['Hip thrust', 'Glutes', 'Barbell'], ['Glute bridge', 'Glutes', 'Barbell'], ['Cable kickback', 'Glutes', 'Cable'], ['Hip abduction', 'Glutes', 'Machine'],
    ['Standing calf raise', 'Calves', 'Machine'], ['Seated calf raise', 'Calves', 'Machine'],
    ['Plank', 'Core', 'Bodyweight', 't'], ['Crunch', 'Core', 'Bodyweight', 'bw'], ['Hanging leg raise', 'Core', 'Bodyweight', 'bw'],
    ['Cable crunch', 'Core', 'Cable'], ['Ab wheel', 'Core', 'Bodyweight', 'bw'], ['Russian twist', 'Core', 'Bodyweight', 'bw'],
    ['Wrist curl', 'Forearms', 'Dumbbell'], ["Farmer's carry", 'Forearms', 'Dumbbell', 't'],
    ['Running', 'Cardio', 'Cardio', 'c'], ['Cycling', 'Cardio', 'Cardio', 'c'], ['Rowing machine', 'Cardio', 'Cardio', 'c'],
    ['Stair climber', 'Cardio', 'Cardio', 'c'], ['Incline walk', 'Cardio', 'Cardio', 'c'], ['Jump rope', 'Cardio', 'Cardio', 'c'],
].map(([name, muscle, eq, kind]) => ({ name, muscle, eq, kind: kind || 'w' }));

// ---------- basic foods (per 100 g): name, kcal, protein, carbs, fat · searched instantly, before Open Food Facts
const GYM_FOODS = [
    ['Chicken breast (cooked)', 165, 31, 0, 3.6], ['Chicken thigh (cooked)', 209, 26, 0, 10.9], ['Beef mince 10% (cooked)', 217, 26, 0, 12],
    ['Steak, sirloin (cooked)', 206, 29, 0, 9], ['Salmon (cooked)', 206, 22, 0, 12], ['Tuna, canned in water', 116, 26, 0, 0.8],
    ['Shrimp (cooked)', 99, 24, 0.2, 0.3], ['Egg (1 egg ≈ 50 g)', 143, 12.6, 0.7, 9.5], ['Egg white', 52, 10.9, 0.7, 0.2],
    ['Greek yogurt 0%', 59, 10, 3.6, 0.4], ['Greek yogurt 2%', 73, 9.9, 3.9, 2], ['Cottage cheese', 98, 11, 3.4, 4.3],
    ['Milk, semi-skimmed', 47, 3.4, 4.8, 1.7], ['Whey protein powder', 400, 80, 8, 6], ['Cheddar cheese', 403, 25, 1.3, 33], ['Mozzarella', 280, 28, 3, 17],
    ['White rice (cooked)', 130, 2.7, 28, 0.3], ['Brown rice (cooked)', 112, 2.3, 24, 0.8], ['Pasta (cooked)', 158, 5.8, 31, 0.9],
    ['Oats (dry)', 389, 16.9, 66, 6.9], ['Bread, white', 265, 9, 49, 3.2], ['Bread, wholemeal', 247, 13, 41, 3.4], ['Potato (boiled)', 87, 1.9, 20, 0.1],
    ['Sweet potato (baked)', 90, 2, 21, 0.2], ['Quinoa (cooked)', 120, 4.4, 21, 1.9], ['Tortilla wrap', 310, 8, 52, 7.5], ['Granola', 471, 10, 64, 20],
    ['Banana', 89, 1.1, 23, 0.3], ['Apple', 52, 0.3, 14, 0.2], ['Orange', 47, 0.9, 12, 0.1], ['Blueberries', 57, 0.7, 14, 0.3], ['Strawberries', 32, 0.7, 7.7, 0.3],
    ['Avocado', 160, 2, 8.5, 14.7], ['Broccoli', 34, 2.8, 7, 0.4], ['Spinach', 23, 2.9, 3.6, 0.4], ['Carrot', 41, 0.9, 10, 0.2], ['Tomato', 18, 0.9, 3.9, 0.2],
    ['Cucumber', 15, 0.7, 3.6, 0.1], ['Mixed salad', 17, 1.3, 3, 0.2], ['Peanut butter', 588, 25, 20, 50], ['Almonds', 579, 21, 22, 50], ['Olive oil', 884, 0, 0, 100],
    ['Butter', 717, 0.9, 0.1, 81], ['Honey', 304, 0.3, 82, 0], ['Lentils (cooked)', 116, 9, 20, 0.4], ['Chickpeas (cooked)', 164, 8.9, 27, 2.6],
    ['Black beans (cooked)', 132, 8.9, 24, 0.5], ['Tofu', 76, 8, 1.9, 4.8], ['Hummus', 166, 7.9, 14, 9.6], ['Dark chocolate 70%', 598, 7.8, 46, 43],
    ['Protein bar', 350, 30, 35, 10], ['Orange juice', 45, 0.7, 10, 0.2], ['Cola', 42, 0, 10.6, 0], ['Coffee, black', 2, 0.3, 0, 0],
    ['Pizza (cheese)', 266, 11, 33, 10], ['Burger in a bun', 254, 13, 24, 12], ['Fries', 312, 3.4, 41, 15], ['Sushi, salmon nigiri', 150, 7, 25, 2],
].map(([name, kcal, p, c, f]) => ({ name, per100: { kcal, p, c, f }, serving: null, src: 'basic' }));

// ---------- ready-made plans: routines [name, [[exercise, sets, reps], …]] and the week (0 = Sunday … 6 = Saturday)
const GYM_TEMPLATES = [
    { id: 'ppl', name: 'Push / Pull / Legs', note: '6 days', days: { 1: 'Push', 2: 'Pull', 3: 'Legs', 4: 'Push', 5: 'Pull', 6: 'Legs' }, routines: [
        ['Push', [['Bench press', 4, '6-8'], ['Overhead press', 3, '8-10'], ['Incline dumbbell press', 3, '8-12'], ['Lateral raise', 3, '12-15'], ['Triceps pushdown', 3, '10-12'], ['Overhead triceps extension', 3, '10-12']]],
        ['Pull', [['Deadlift', 3, '5'], ['Pull-up', 3, '6-10'], ['Barbell row', 3, '8-10'], ['Face pull', 3, '12-15'], ['Barbell curl', 3, '8-12'], ['Hammer curl', 3, '10-12']]],
        ['Legs', [['Squat', 4, '6-8'], ['Romanian deadlift', 3, '8-10'], ['Leg press', 3, '10-12'], ['Lying leg curl', 3, '10-12'], ['Standing calf raise', 4, '10-15']]]] },
    { id: 'ul', name: 'Upper / Lower', note: '4 days', days: { 1: 'Upper', 2: 'Lower', 4: 'Upper', 5: 'Lower' }, routines: [
        ['Upper', [['Bench press', 4, '6-8'], ['Barbell row', 4, '6-8'], ['Overhead press', 3, '8-10'], ['Lat pulldown', 3, '10-12'], ['Dumbbell curl', 2, '10-12'], ['Triceps pushdown', 2, '10-12']]],
        ['Lower', [['Squat', 4, '6-8'], ['Romanian deadlift', 3, '8-10'], ['Leg press', 3, '10-12'], ['Leg extension', 3, '12-15'], ['Seated calf raise', 4, '12-15'], ['Hanging leg raise', 3, '10-15']]]] },
    { id: 'fb', name: 'Full body', note: '3 days', days: { 1: 'Full body A', 3: 'Full body B', 5: 'Full body A' }, routines: [
        ['Full body A', [['Squat', 3, '6-8'], ['Bench press', 3, '6-8'], ['Barbell row', 3, '8-10'], ['Lateral raise', 2, '12-15'], ['Plank', 3, '']]],
        ['Full body B', [['Deadlift', 3, '5'], ['Overhead press', 3, '8-10'], ['Pull-up', 3, '6-10'], ['Bulgarian split squat', 2, '10-12'], ['Dumbbell curl', 2, '10-12']]]] },
    { id: '55', name: '5 × 5 strength', note: '3 days', days: { 1: '5×5 A', 3: '5×5 B', 5: '5×5 A' }, routines: [
        ['5×5 A', [['Squat', 5, '5'], ['Bench press', 5, '5'], ['Barbell row', 5, '5']]],
        ['5×5 B', [['Squat', 5, '5'], ['Overhead press', 5, '5'], ['Deadlift', 1, '5']]]] },
    { id: 'bro', name: 'Bro split', note: '5 days', days: { 1: 'Chest', 2: 'Back', 3: 'Shoulders', 4: 'Arms', 5: 'Legs' }, routines: [
        ['Chest', [['Bench press', 4, '6-10'], ['Incline dumbbell press', 3, '8-12'], ['Cable fly', 3, '12-15'], ['Dips', 3, '8-12']]],
        ['Back', [['Deadlift', 3, '5'], ['Pull-up', 3, '6-10'], ['Seated cable row', 3, '10-12'], ['Lat pulldown', 3, '10-12']]],
        ['Shoulders', [['Overhead press', 4, '6-10'], ['Lateral raise', 4, '12-15'], ['Rear delt fly', 3, '12-15'], ['Shrug', 3, '10-12']]],
        ['Arms', [['Barbell curl', 3, '8-12'], ['Skull crusher', 3, '8-12'], ['Hammer curl', 3, '10-12'], ['Triceps pushdown', 3, '10-12'], ['Preacher curl', 2, '10-12']]],
        ['Legs', [['Squat', 4, '6-10'], ['Leg press', 3, '10-12'], ['Romanian deadlift', 3, '8-10'], ['Lying leg curl', 3, '10-12'], ['Standing calf raise', 4, '10-15']]]] },
];
const GYM_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GYM_MEALS = [['breakfast', 'Breakfast', 'fa-mug-hot'], ['lunch', 'Lunch', 'fa-bowl-food'], ['dinner', 'Dinner', 'fa-utensils'], ['snacks', 'Snacks', 'fa-cookie-bite']];
const GYM_TABS = [['today', 'Today', 'fa-house'], ['workout', 'Workout', 'fa-dumbbell'], ['plan', 'Plan', 'fa-calendar-week'], ['progress', 'Progress', 'fa-chart-line'], ['food', 'Food', 'fa-apple-whole'], ['body', 'Body', 'fa-weight-scale'], ['tools', 'Tools', 'fa-calculator']];
const GYM_ACTIVITY = [[1.2, 'Little or no exercise'], [1.375, 'Light (1–3 days a week)'], [1.55, 'Moderate (3–5 days a week)'], [1.725, 'Hard (6–7 days a week)'], [1.9, 'Very hard (physical job + training)']];
const LB = 2.20462;

// eslint-disable-next-line no-unused-vars
const GymSection = {
    props: { user: { type: String, default: '' }, toast: { type: Function, default: null }, confirm: { type: Function, default: null } },
    setup(props) {
        const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue;
        const say = (m, t) => (props.toast ? props.toast(m, t) : console.log(m));
        const ask = (o) => (props.confirm ? props.confirm(o) : Promise.resolve(window.confirm(o.title)));
        const lsKey = (k) => 'anicoop_gym_' + k + ':' + props.user;
        const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(lsKey(k)) || 'null'); } catch { return null; } };
        const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(lsKey(k)); else localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch { /* private mode */ } };
        const pad = (n) => String(n).padStart(2, '0');
        const dstr = (d = Date.now()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
        const dayDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
        const addDays = (s, n) => { const d = dayDate(s); d.setDate(d.getDate() + n); return dstr(d); };
        const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
        const r1 = (n) => Math.round(n * 10) / 10;
        const fmtDay = (s) => { const t = dstr(); if (s === t) return 'Today'; if (s === addDays(t, -1)) return 'Yesterday'; if (s === addDays(t, 1)) return 'Tomorrow'; return dayDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
        const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(new Date(iso).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
        const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
        const clock = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

        // ---------- settings ----------
        const defaults = () => ({ units: 'kg', restSec: 90, schedule: {}, targets: { kcal: 2200, p: 150, c: 230, f: 70, water: 2500 }, custom: [],
            goalWeight: null, profile: { sex: 'm', age: 25, height: 175, activity: 1.55, goal: 'maintain' }, bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] });
        const S = reactive({ loading: true, missing: false, error: '', settings: defaults(), routines: [], workouts: [], days: {}, foods: [], foodsDay: dstr(), recents: [] });
        const tab = ref(lsGet('tab') || 'today');
        watch(tab, (t) => lsSet('tab', t));
        const lb = computed(() => S.settings.units === 'lb');
        const unit = computed(() => (lb.value ? 'lb' : 'kg'));
        // weights are kept in kg; shown (and typed) in your unit
        const show = (kg) => { if (kg == null || kg === '') return ''; const v = lb.value ? kg * LB : kg; return Math.round(v * (lb.value ? 2 : 4)) / (lb.value ? 2 : 4); };
        const toKg = (v) => (lb.value ? num(v) / LB : num(v));
        const showW = (kg) => (kg == null || kg === '' ? '' : r1(lb.value ? kg * LB : kg));   // body weight: to 0.1 (lifts: to plate steps)
        let saveTimer = null;
        const saveSettings = () => { clearTimeout(saveTimer); saveTimer = setTimeout(async () => {
            const { error } = await sb.from('gym_settings').upsert({ user_id: props.user, data: JSON.parse(JSON.stringify(S.settings)), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (error && !S.missing) say('Could not save your gym settings: ' + error.message, 'error');
        }, 600); };
        const setUnits = (u) => { S.settings.units = u; saveSettings(); };

        // ---------- loading ----------
        const load = async () => {
            if (!props.user) return;
            S.loading = true; S.error = '';
            const uid = props.user, since = addDays(dstr(), -400);
            const [st, rt, wk, dy] = await Promise.all([
                sb.from('gym_settings').select('data').eq('user_id', uid).maybeSingle(),
                sb.from('gym_routines').select('*').eq('user_id', uid).order('created_at'),
                sb.from('gym_workouts').select('*').eq('user_id', uid).order('started_at', { ascending: false }).limit(1500),
                sb.from('gym_days').select('*').eq('user_id', uid).gte('day', since),
            ]);
            const err = st.error || rt.error || wk.error || dy.error;
            S.loading = false;
            if (err) { S.missing = /gym_|schema cache|does not exist/i.test(err.message || ''); S.error = S.missing ? '' : err.message; return; }
            S.missing = false;
            const d = defaults(), x = st.data?.data || {};
            S.settings = { ...d, ...x, targets: { ...d.targets, ...(x.targets || {}) }, profile: { ...d.profile, ...(x.profile || {}) }, schedule: x.schedule || {}, custom: x.custom || [] };
            S.routines = rt.data || [];
            S.workouts = (wk.data || []).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
            S.days = Object.fromEntries((dy.data || []).map(r => [r.day, r]));
            loadFoods(S.foodsDay); loadRecents();
        };
        onMounted(load);
        watch(() => props.user, (u, o) => { if (u && u !== o) { active.value = lsGet('active'); load(); } });

        // ---------- exercises ----------
        const allExercises = computed(() => [...GYM_EXERCISES, ...(S.settings.custom || []).map(c => ({ ...c, custom: true }))]);
        const exInfo = (name) => allExercises.value.find(e => e.name.toLowerCase() === String(name).toLowerCase()) || { name, muscle: 'Other', eq: '', kind: 'w' };
        const KIND_FIELDS = { w: ['kg', 'reps'], bw: ['+kg', 'reps'], t: [null, 'sec'], c: ['km', 'min'] };
        const fieldLabel = (kind, k) => { const f = KIND_FIELDS[kind || 'w'][k]; return f === 'kg' ? unit.value : f === '+kg' ? '+' + unit.value : f; };
        const e1rm = (w, r) => (w > 0 && r > 0 ? (r === 1 ? w : w * (1 + r / 30)) : 0);
        const isWeighted = (kind) => kind === 'w' || kind === 'bw';
        // every session of an exercise, oldest first: { at, sets, best (e1RM), top (heaviest), vol }
        const sessionsOf = (name) => {
            const out = [];
            for (let k = S.workouts.length - 1; k >= 0; k--) {
                const w = S.workouts[k];
                const e = (w.exercises || []).find(x => x.name === name); if (!e?.sets?.length) continue;
                const sets = e.sets;
                out.push({ at: w.started_at, id: w.id, sets, best: Math.max(0, ...sets.map(s => e1rm(s.w, s.r))), top: Math.max(0, ...sets.map(s => s.w || 0)), vol: sets.reduce((a, s) => a + (s.w || 0) * (s.r || 0), 0), reps: Math.max(0, ...sets.map(s => s.r || 0)) });
            }
            return out;
        };
        const lastSession = (name) => { for (const w of S.workouts) { const e = (w.exercises || []).find(x => x.name === name); if (e?.sets?.length) return { at: w.started_at, sets: e.sets }; } return null; };
        const parseReps = (s) => { const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(String(s || '')); return m ? [Number(m[1]), Number(m[2] || m[1])] : null; };
        const incOf = (name) => {
            const e = exInfo(name), lower = ['Quads', 'Hamstrings', 'Glutes'].includes(e.muscle);
            if (lb.value) return e.eq === 'Dumbbell' ? 5 / LB : lower && e.eq !== 'Dumbbell' ? 10 / LB : 5 / LB;
            return e.eq === 'Dumbbell' ? 2 : lower ? 5 : 2.5;
        };
        // progressive overload ("double progression"): hit the top of your rep range on every set → more weight;
        // otherwise the same weight and one more rep. (No range: 12 reps on every set means it's time to go up.)
        const suggest = (name, reps) => {
            const e = exInfo(name); if (!isWeighted(e.kind)) return null;
            const last = lastSession(name); if (!last) return null;
            const work = last.sets.filter(s => s.r > 0 && (e.kind === 'bw' || s.w > 0)); if (!work.length) return null;
            const top = Math.max(...work.map(s => s.w || 0)), atTop = work.filter(s => (s.w || 0) === top);
            const range = parseReps(reps), hi = range ? range[1] : 12, lo = range ? range[0] : Math.min(...atTop.map(s => s.r));
            if (atTop.every(s => s.r >= hi)) {
                if (e.kind === 'bw' && !top) return { w: 0, r: hi, up: true, text: `You hit ${hi} reps on every set: add weight or do ${hi + 1}+` };
                const w = top + incOf(name);
                return { w, r: lo, up: true, text: `You hit ${hi} reps on every set: go up to ${show(w)} ${unit.value} × ${lo}` };
            }
            const need = Math.min(...atTop.map(s => s.r)) + 1;
            return { w: top, r: need, up: false, text: `Same ${top ? show(top) + ' ' + unit.value : 'weight'}, aim for ${Math.min(need, hi)} reps on every set` };
        };
        const setText = (s, kind) => kind === 't' ? `${s.r}s` : kind === 'c' ? `${s.w || 0} km · ${s.r} min` : `${kind === 'bw' && !s.w ? 'BW' : show(s.w)}×${s.r}`;
        const lastText = (name) => { const l = lastSession(name); if (!l) return ''; const k = exInfo(name).kind; return l.sets.map(s => setText(s, k)).join(' · '); };

        // ---------- the workout you're doing (kept in this browser until you finish it) ----------
        const active = ref(lsGet('active'));
        watch(active, (a) => lsSet('active', a), { deep: true });
        const now = ref(Date.now());
        let clockTimer = setInterval(() => { now.value = Date.now(); }, 1000);
        const elapsed = computed(() => (active.value ? clock(Math.max(0, now.value - active.value.startedAt) / 1000) : ''));
        const buildEx = (name, t = {}) => {
            const info = exInfo(name), last = lastSession(name), sug = suggest(name, t.reps);
            const n = Number(t.sets) || last?.sets.length || 3;
            const sets = Array.from({ length: n }, (_, i) => {
                const p = last?.sets[i] || last?.sets[last.sets.length - 1];
                return { w: info.kind === 't' ? '' : sug ? show(sug.w) : p ? (info.kind === 'c' ? p.w : show(p.w)) : '', r: '', done: false };
            });
            return { name: info.name, muscle: info.muscle, kind: info.kind, reps: t.reps || '', rest: Number(t.rest) || null, sets, hint: sug?.text || '', up: !!sug?.up };
        };
        const startWorkout = async (routine = null, from = null) => {
            if (active.value && !(await ask({ title: 'Start a new workout?', body: 'The one you’re doing now is thrown away.', ok: 'Start new' }))) return;
            const exs = routine ? (routine.exercises || []).map(e => buildEx(e.name, e)) : from ? (from.exercises || []).map(e => buildEx(e.name, { sets: e.sets.length })) : [];
            active.value = { name: routine?.name || from?.name || 'Workout', routineId: routine?.id || null, startedAt: Date.now(), unit: unit.value, exercises: exs, notes: '' };
            tab.value = 'workout';
        };
        const todayRoutine = computed(() => { const id = S.settings.schedule?.[new Date().getDay()]; return id ? S.routines.find(r => r.id === id) || null : null; });
        const addSet = (e) => { const p = e.sets[e.sets.length - 1]; e.sets.push({ w: p ? p.w : '', r: '', done: false }); };
        const removeSet = (e, i) => { e.sets.splice(i, 1); };
        const moveEx = (i, d) => { const l = active.value.exercises, j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; };
        const removeEx = async (i) => { if (await ask({ title: 'Remove ' + active.value.exercises[i].name + '?', ok: 'Remove' })) active.value.exercises.splice(i, 1); };
        const prevOf = (e, i) => { const l = lastSession(e.name); const s = l?.sets[i]; return s ? setText(s, e.kind) : '–'; };
        const toggleDone = (e, s) => {
            if (!s.done && !num(s.r)) { const sug = e.hint ? parseReps(e.reps) : null; s.r = sug ? sug[0] : (lastSession(e.name)?.sets[e.sets.indexOf(s)]?.r || ''); if (!num(s.r)) { say('Type the reps first', 'error'); return; } }
            s.done = !s.done;
            if (s.done) startRest(e.rest || S.settings.restSec);
        };
        const discard = async () => { if (await ask({ title: 'Discard this workout?', body: 'Nothing is saved.', ok: 'Discard' })) { active.value = null; stopRest(); } };
        const summary = ref(null);
        const finish = async () => {
            const a = active.value; if (!a) return;
            const conv = (v, kind) => (kind === 'c' || kind === 't' ? num(v) : a.unit === 'lb' ? num(v) / LB : num(v));
            const exercises = a.exercises.map(e => ({ name: e.name, muscle: e.muscle, kind: e.kind,
                sets: e.sets.filter(s => s.done || num(s.r) > 0).map(s => ({ w: Math.round(conv(s.w, e.kind) * 100) / 100, r: num(s.r) })) })).filter(e => e.sets.length);
            if (!exercises.length) { if (await ask({ title: 'Nothing logged yet', body: 'Tick at least one set (or type its reps). Throw this workout away?', ok: 'Discard' })) { active.value = null; stopRest(); } return; }
            // personal records: compared with everything before this workout
            const prs = [];
            exercises.forEach(e => {
                if (!isWeighted(e.kind)) return;
                const old = sessionsOf(e.name); if (!old.length) return;
                const best = Math.max(...old.map(s => s.best)), top = Math.max(...old.map(s => s.top));
                const nb = Math.max(...e.sets.map(s => e1rm(s.w, s.r))), nt = Math.max(...e.sets.map(s => s.w || 0));
                if (nt > top) prs.push(`${e.name}: heaviest ever, ${show(nt)} ${unit.value}`);
                else if (nb > best + 0.01) prs.push(`${e.name}: best estimated 1RM, ${show(nb)} ${unit.value}`);
            });
            const row = { user_id: props.user, name: (a.name || 'Workout').slice(0, 80), routine_id: a.routineId, started_at: new Date(a.startedAt).toISOString(), ended_at: new Date().toISOString(), exercises, notes: (a.notes || '').slice(0, 2000) || null };
            const { data, error } = await sb.from('gym_workouts').insert(row).select().single();
            if (error) { say('Could not save the workout: ' + error.message, 'error'); return; }
            S.workouts.unshift(data || row);
            const vol = exercises.reduce((t, e) => t + (isWeighted(e.kind) ? e.sets.reduce((x, s) => x + (s.w || 0) * (s.r || 0), 0) : 0), 0);
            summary.value = { name: row.name, dur: fmtDur(Date.now() - a.startedAt), sets: exercises.reduce((t, e) => t + e.sets.length, 0), exercises: exercises.length, vol: Math.round(show(vol)), prs };
            active.value = null; stopRest();
        };
        const deleteWorkout = async (w) => {
            if (!(await ask({ title: 'Delete this workout?', body: `${w.name} · ${fmtDate(w.started_at)}`, ok: 'Delete' }))) return;
            const { error } = await sb.from('gym_workouts').delete().eq('id', w.id);
            if (error) { say(error.message, 'error'); return; }
            S.workouts = S.workouts.filter(x => x.id !== w.id);
        };
        const openWorkout = ref(null);
        const workoutVol = (w) => (w.exercises || []).reduce((t, e) => t + (isWeighted(e.kind) ? e.sets.reduce((x, s) => x + (s.w || 0) * (s.r || 0), 0) : 0), 0);

        // ---------- rest timer (starts when you tick a set) ----------
        const rest = reactive({ on: false, left: 0, total: 0, end: 0 });
        let restTimer = null;
        const beep = () => { try { const C = window.AudioContext || window.webkitAudioContext; const ac = new C(); [0, 0.32].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2); }); setTimeout(() => ac.close(), 1200); } catch { /* no sound */ } };
        const restTick = () => { rest.left = Math.max(0, Math.ceil((rest.end - Date.now()) / 1000)); if (rest.on && rest.left <= 0) { stopRest(); beep(); try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ } say('Rest is over: next set 💪'); } };
        const startRest = (sec) => { if (!sec) return; rest.total = sec; rest.end = Date.now() + sec * 1000; rest.on = true; restTick(); clearInterval(restTimer); restTimer = setInterval(restTick, 250); };
        const stopRest = () => { rest.on = false; clearInterval(restTimer); };
        const restAdd = (d) => { rest.end += d * 1000; rest.total = Math.max(rest.total + d, 1); restTick(); };
        onBeforeUnmount(() => { clearInterval(restTimer); clearInterval(clockTimer); clearInterval(scanTimer); stopScan(); });

        // ---------- picking an exercise (for a workout or a routine) ----------
        const picker = reactive({ open: false, q: '', muscle: '', for: null, custom: { name: '', muscle: 'Chest', kind: 'w' }, adding: false });
        const openPicker = (target) => Object.assign(picker, { open: true, q: '', muscle: '', for: target, adding: false });
        const pickerList = computed(() => {
            const q = picker.q.trim().toLowerCase();
            return allExercises.value.filter(e => (!picker.muscle || e.muscle === picker.muscle) && (!q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q)));
        });
        const usedCount = computed(() => { const c = {}; S.workouts.forEach(w => (w.exercises || []).forEach(e => { c[e.name] = (c[e.name] || 0) + 1; })); return c; });
        const pickEx = (e) => {
            if (picker.for === 'workout' && active.value) active.value.exercises.push(buildEx(e.name));
            else if (picker.for === 'routine') editR.exercises.push({ name: e.name, sets: 3, reps: isWeighted(e.kind) ? '8-12' : '', rest: '' });
            picker.open = false;
        };
        const addCustom = () => {
            const name = picker.custom.name.trim(); if (!name) return;
            if (allExercises.value.some(e => e.name.toLowerCase() === name.toLowerCase())) { say('That exercise is already in the list', 'error'); return; }
            S.settings.custom = [...(S.settings.custom || []), { name: name.slice(0, 60), muscle: picker.custom.muscle, eq: 'Custom', kind: picker.custom.kind }];
            saveSettings(); picker.custom.name = ''; picker.adding = false;
            pickEx({ name, kind: picker.custom.kind });
        };

        // ---------- routines + the weekly plan ----------
        const editR = reactive({ open: false, id: null, name: '', exercises: [], saving: false });
        const openRoutine = (r = null) => Object.assign(editR, { open: true, id: r?.id || null, name: r?.name || '', exercises: JSON.parse(JSON.stringify(r?.exercises || [])), saving: false });
        const saveRoutine = async () => {
            const name = editR.name.trim(); if (!name) { say('Give the routine a name', 'error'); return; }
            editR.saving = true;
            const exercises = editR.exercises.map(e => ({ name: e.name, sets: Math.max(1, Math.min(20, Number(e.sets) || 3)), reps: String(e.reps || '').slice(0, 12), rest: Number(e.rest) || null }));
            const q = editR.id ? sb.from('gym_routines').update({ name: name.slice(0, 80), exercises, updated_at: new Date().toISOString() }).eq('id', editR.id)
                : sb.from('gym_routines').insert({ user_id: props.user, name: name.slice(0, 80), exercises });
            const { data, error } = await q.select().single();
            editR.saving = false;
            if (error) { say('Could not save: ' + error.message, 'error'); return; }
            if (editR.id) { const i = S.routines.findIndex(r => r.id === editR.id); if (i >= 0) S.routines[i] = data; } else S.routines.push(data);
            editR.open = false;
        };
        const deleteRoutine = async (r) => {
            if (!(await ask({ title: 'Delete the routine “' + r.name + '”?', body: 'Your past workouts stay.', ok: 'Delete' }))) return;
            const { error } = await sb.from('gym_routines').delete().eq('id', r.id);
            if (error) { say(error.message, 'error'); return; }
            S.routines = S.routines.filter(x => x.id !== r.id);
            for (const k of Object.keys(S.settings.schedule)) if (S.settings.schedule[k] === r.id) S.settings.schedule[k] = null;
            saveSettings();
        };
        const moveREx = (i, d) => { const l = editR.exercises, j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; };
        const setDay = (day, id) => { const r = S.routines.find(x => String(x.id) === String(id)); S.settings.schedule = { ...S.settings.schedule, [day]: r ? r.id : null }; saveSettings(); };
        const weekOrder = [1, 2, 3, 4, 5, 6, 0];
        const routineName = (id) => S.routines.find(r => r.id === id)?.name || '';
        const applyTemplate = async (t) => {
            if (!(await ask({ title: 'Add “' + t.name + '”?', body: `Adds ${t.routines.length} routine${t.routines.length === 1 ? '' : 's'} and puts them in your week (${t.note}). Your other routines stay.`, ok: 'Add it', danger: false }))) return;
            const rows = t.routines.map(([name, list]) => ({ user_id: props.user, name, exercises: list.map(([n, sets, reps]) => ({ name: n, sets, reps, rest: null })) }));
            const { data, error } = await sb.from('gym_routines').insert(rows).select();
            if (error) { say('Could not add it: ' + error.message, 'error'); return; }
            const made = data || [];
            S.routines.push(...made);
            const sched = {}; for (let d = 0; d < 7; d++) { const nm = t.days[d]; sched[d] = nm ? made.find(r => r.name === nm)?.id || null : null; }
            S.settings.schedule = sched; saveSettings();
            say(`${t.name} added to your plan`);
        };

        // ---------- progress ----------
        const prog = reactive({ ex: '' });
        const loggedExercises = computed(() => Object.entries(usedCount.value).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n, muscle: exInfo(name).muscle })));
        watch(loggedExercises, (l) => { if (!prog.ex && l.length) prog.ex = l[0].name; }, { immediate: true });
        const progSessions = computed(() => (prog.ex ? sessionsOf(prog.ex) : []));
        const progKind = computed(() => exInfo(prog.ex).kind);
        const prs = computed(() => {
            const s = progSessions.value; if (!s.length) return [];
            const k = progKind.value, sets = s.flatMap(x => x.sets.map(y => ({ ...y, at: x.at })));
            const by = (f) => sets.reduce((b, x) => (f(x) > f(b) ? x : b), sets[0]);
            if (!isWeighted(k)) { const b = by(x => x.r); return [{ l: k === 't' ? 'Longest' : 'Longest session', v: k === 't' ? b.r + ' s' : b.r + ' min', at: b.at }, { l: 'Sessions', v: s.length }]; }
            const h = by(x => x.w || 0), e = by(x => e1rm(x.w, x.r)), v = by(x => (x.w || 0) * x.r), m = by(x => x.r);
            return [{ l: 'Heaviest', v: `${show(h.w)} ${unit.value} × ${h.r}`, at: h.at }, { l: 'Best est. 1RM', v: `${show(e1rm(e.w, e.r))} ${unit.value}`, at: e.at },
                { l: 'Best set (volume)', v: `${show(v.w)} × ${v.r}`, at: v.at }, { l: 'Most reps', v: `${m.r} reps${m.w ? ' @ ' + show(m.w) : ''}`, at: m.at }, { l: 'Sessions', v: s.length }];
        });
        // a line chart (inline SVG): points [{x: time, y}] → path, dots, labels
        const chart = (pts, w = 600, h = 180, padX = 34, padY = 18) => {
            if (pts.length < 1) return null;
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
            let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 864e5; x1 += 864e5; }
            let y0 = Math.min(...ys), y1 = Math.max(...ys); const m = (y1 - y0) * 0.12 || Math.max(1, y1 * 0.05); y0 -= m; y1 += m;
            const X = (x) => padX + (x - x0) / (x1 - x0) * (w - padX - 8), Y = (y) => h - padY - (y - y0) / (y1 - y0) * (h - padY * 2);
            const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
            const ticks = [y1 - m, (y0 + y1) / 2, y0 + m].map(v => ({ y: Y(v), v: r1(v) }));
            return { w, h, d, dots: pts.map(p => ({ x: X(p.x), y: Y(p.y), v: p.y, at: p.x })), ticks, area: d + ` L${X(pts[pts.length - 1].x).toFixed(1)} ${h - padY} L${X(pts[0].x).toFixed(1)} ${h - padY} Z` };
        };
        const progChart = computed(() => {
            const k = progKind.value;
            const pts = progSessions.value.map(s => ({ x: new Date(s.at).getTime(), y: isWeighted(k) ? (show(s.best) || s.reps) : s.reps }));
            return chart(pts.slice(-40));
        });
        const weekStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
        const thisWeek = computed(() => S.workouts.filter(w => new Date(w.started_at).getTime() >= weekStart(now.value)));
        const weeks = computed(() => {   // the last 8 weeks: workouts + volume
            const out = []; const w0 = weekStart(now.value);
            for (let k = 7; k >= 0; k--) { const s = w0 - k * 7 * 864e5, e = s + 7 * 864e5; const list = S.workouts.filter(w => { const t = new Date(w.started_at).getTime(); return t >= s && t < e; }); out.push({ s, n: list.length, vol: Math.round(show(list.reduce((a, w) => a + workoutVol(w), 0))) }); }
            const max = Math.max(1, ...out.map(x => x.vol)); out.forEach(x => { x.pct = Math.round(x.vol / max * 100); x.label = new Date(x.s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); });
            return out;
        });
        const muscleSets = computed(() => {   // sets per muscle this week
            const c = {}; thisWeek.value.forEach(w => (w.exercises || []).forEach(e => { c[e.muscle || 'Other'] = (c[e.muscle || 'Other'] || 0) + e.sets.length; }));
            const max = Math.max(1, ...Object.values(c));
            return GYM_MUSCLES.map(m => ({ m, n: c[m] || 0, pct: Math.round((c[m] || 0) / max * 100) })).filter(x => x.n || x.m !== 'Cardio');
        });
        const streak = computed(() => {   // weeks in a row with at least one workout (this week counts once you've trained)
            const has = new Set(S.workouts.map(w => weekStart(new Date(w.started_at).getTime())));
            let w = weekStart(now.value), n = 0; if (!has.has(w)) w -= 7 * 864e5;
            while (has.has(w)) { n++; w -= 7 * 864e5; }
            return n;
        });
        const heat = computed(() => {   // the last 16 weeks, a square per day
            const count = {}; S.workouts.forEach(w => { const d = dstr(w.started_at); count[d] = (count[d] || 0) + 1; });
            const start = weekStart(now.value) - 15 * 7 * 864e5, cols = [];
            for (let c = 0; c < 16; c++) { const col = []; for (let r = 0; r < 7; r++) { const t = start + (c * 7 + r) * 864e5; const d = dstr(t); col.push({ d, n: count[d] || 0, future: t > now.value }); } cols.push(col); }
            return cols;
        });

        // ---------- body weight / water ----------
        const today = computed(() => S.days[dstr(now.value)] || {});
        const weightIn = ref('');
        const saveDay = async (day, patch) => {
            const row = { user_id: props.user, day, ...patch, updated_at: new Date().toISOString() };
            const prev = S.days[day]; S.days[day] = { ...(prev || {}), ...row };
            const { error } = await sb.from('gym_days').upsert(row, { onConflict: 'user_id,day' });
            if (error) { S.days[day] = prev; say('Could not save: ' + error.message, 'error'); }
        };
        const logWeight = async (day = dstr()) => { const v = toKg(weightIn.value); if (!(v > 20 && v < 500)) { say('Type your weight', 'error'); return; } await saveDay(day, { weight: Math.round(v * 100) / 100 }); weightIn.value = ''; say('Weight saved'); };
        const weights = computed(() => Object.values(S.days).filter(d => d.weight).sort((a, b) => a.day.localeCompare(b.day)));
        const avg7 = (i, list) => { const t = dayDate(list[i].day).getTime(); const w = list.filter(x => { const u = dayDate(x.day).getTime(); return u <= t && u > t - 7 * 864e5; }); return w.reduce((a, x) => a + x.weight, 0) / w.length; };
        const bodyRange = ref(90);
        const weightChart = computed(() => {
            const from = dstr(now.value - bodyRange.value * 864e5), list = weights.value, shown = list.filter(x => x.day >= from);
            const c = chart(shown.map(x => ({ x: dayDate(x.day).getTime(), y: showW(x.weight) })));
            if (!c) return null;
            const idx = list.map((x, i) => [x, i]).filter(([x]) => x.day >= from);
            const avg = chart(idx.map(([x, i]) => ({ x: dayDate(x.day).getTime(), y: showW(avg7(i, list)) })));
            return { ...c, avg: avg?.d || '' };
        });
        const bodyStats = computed(() => {
            const list = weights.value; if (!list.length) return null;
            const last = list[list.length - 1], a = avg7(list.length - 1, list);
            const old = list.filter(x => x.day <= addDays(last.day, -28)).pop();
            const goal = num(S.settings.goalWeight) || null;
            return { now: showW(last.weight), day: last.day, avg: showW(a), change: old ? r1(showW(last.weight) - showW(old.weight)) : null, goal: goal ? showW(goal) : null, left: goal ? r1(showW(last.weight) - showW(goal)) : null };
        });
        const water = computed(() => S.days[S.foodsDay]?.water_ml || 0);
        const addWater = (ml) => saveDay(S.foodsDay, { water_ml: Math.max(0, Math.min(20000, water.value + ml)) });

        // ---------- food & macros ----------
        const loadFoods = async (day) => {
            const { data, error } = await sb.from('gym_foods').select('*').eq('user_id', props.user).eq('day', day).order('created_at');
            if (!error && S.foodsDay === day) S.foods = data || [];
        };
        const loadRecents = async () => {
            const { data } = await sb.from('gym_foods').select('name, grams, kcal, protein, carbs, fat, food, meal').eq('user_id', props.user).order('created_at', { ascending: false }).limit(300);
            const seen = new Set(); S.recents = (data || []).filter(r => { const k = r.name.toLowerCase(); return !seen.has(k) && seen.add(k); }).slice(0, 40);
        };
        const goDay = (n) => { S.foodsDay = n === 0 ? dstr() : addDays(S.foodsDay, n); S.foods = []; loadFoods(S.foodsDay); };
        const totals = computed(() => S.foods.reduce((t, f) => ({ kcal: t.kcal + num(f.kcal), p: t.p + num(f.protein), c: t.c + num(f.carbs), f: t.f + num(f.fat) }), { kcal: 0, p: 0, c: 0, f: 0 }));
        const todayTotals = ref({ kcal: 0, p: 0 });
        watch(() => [S.foodsDay, totals.value], () => { if (S.foodsDay === dstr()) todayTotals.value = totals.value; });
        const mealFoods = (m) => S.foods.filter(f => f.meal === m);
        const mealKcal = (m) => Math.round(mealFoods(m).reduce((a, f) => a + num(f.kcal), 0));
        const pctOf = (v, t) => Math.min(100, Math.round(v / Math.max(1, t) * 100));
        const fd = reactive({ open: false, meal: 'breakfast', q: '', results: [], searching: false, pick: null, grams: 100, quick: false, qk: { name: '', kcal: '', p: '', c: '', f: '' }, code: '', scanning: false, err: '' });
        const openFood = (meal) => Object.assign(fd, { open: true, meal, q: '', results: [], pick: null, grams: 100, quick: false, code: '', err: '', qk: { name: '', kcal: '', p: '', c: '', f: '' } });
        const basicHits = computed(() => { const q = fd.q.trim().toLowerCase(); if (!q) return []; return GYM_FOODS.filter(f => q.split(/\s+/).every(w => f.name.toLowerCase().includes(w))).slice(0, 8); });
        const recentHits = computed(() => { const q = fd.q.trim().toLowerCase(); return S.recents.filter(r => !q || r.name.toLowerCase().includes(q)).slice(0, q ? 6 : 12); });
        const offFood = (p) => {
            const n = p.nutriments || {}, kcal = n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
            if (kcal == null) return null;
            const brand = Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0];
            const serving = parseFloat(String(p.serving_size || '').match(/([\d.,]+)\s*g/i)?.[1]?.replace(',', '.')) || null;
            return { name: [p.product_name, brand].filter(Boolean).join(' · ').slice(0, 120) || 'Food', per100: { kcal: r1(kcal), p: r1(n.proteins_100g || 0), c: r1(n.carbohydrates_100g || 0), f: r1(n.fat_100g || 0) }, serving, code: p.code || null, src: 'off' };
        };
        let searchSeq = 0, searchTimer = null;
        watch(() => fd.q, (q) => {
            clearTimeout(searchTimer); fd.results = [];
            if (q.trim().length < 3) { fd.searching = false; return; }
            searchTimer = setTimeout(async () => {
                const seq = ++searchSeq; fd.searching = true;
                try {
                    const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q.trim())}&page_size=24&fields=code,product_name,brands,nutriments,serving_size`;
                    const r = await siteFetch(url);
                    const hits = (JSON.parse(r.body || '{}').hits || []).map(offFood).filter(Boolean);
                    if (seq === searchSeq) fd.results = hits;
                } catch { if (seq === searchSeq) fd.results = []; }
                if (seq === searchSeq) fd.searching = false;
            }, 450);
        });
        const choose = (f) => { fd.pick = f; fd.grams = f.grams || f.serving || 100; };
        const chooseRecent = (r) => choose(r.food?.per100 ? { ...r.food, name: r.name, grams: r.grams } : { name: r.name, per100: null, grams: r.grams, fixed: { kcal: r.kcal, p: r.protein, c: r.carbs, f: r.fat } });
        const pickMacros = computed(() => {
            const f = fd.pick; if (!f) return null;
            if (!f.per100) return f.fixed;
            const g = num(fd.grams) / 100;
            return { kcal: Math.round(f.per100.kcal * g), p: r1(f.per100.p * g), c: r1(f.per100.c * g), f: r1(f.per100.f * g) };
        });
        const insertFood = async (row) => {
            const { data, error } = await sb.from('gym_foods').insert({ user_id: props.user, day: S.foodsDay, ...row }).select().single();
            if (error) { say('Could not add it: ' + error.message, 'error'); return false; }
            S.foods.push(data || row); loadRecents(); return true;
        };
        const addPicked = async () => {
            const f = fd.pick, m = pickMacros.value; if (!f || !m) return;
            const ok = await insertFood({ meal: fd.meal, name: f.name.slice(0, 120), grams: f.per100 ? num(fd.grams) : (f.grams || null), kcal: m.kcal, protein: m.p, carbs: m.c, fat: m.f, food: f.per100 ? { per100: f.per100, serving: f.serving || null, code: f.code || null } : null });
            if (ok) { fd.open = false; say(`${f.name.split(' · ')[0]} added`); }
        };
        const addQuick = async () => {
            const q = fd.qk; if (!q.name.trim() || !(num(q.kcal) >= 0)) { say('Give it a name and its calories', 'error'); return; }
            const ok = await insertFood({ meal: fd.meal, name: q.name.trim().slice(0, 120), grams: null, kcal: Math.round(num(q.kcal)), protein: r1(num(q.p)), carbs: r1(num(q.c)), fat: r1(num(q.f)), food: null });
            if (ok) fd.open = false;
        };
        const removeFood = async (f) => {
            const { error } = await sb.from('gym_foods').delete().eq('id', f.id);
            if (error) { say(error.message, 'error'); return; }
            S.foods = S.foods.filter(x => x.id !== f.id);
        };
        const copyYesterday = async () => {
            const from = addDays(S.foodsDay, -1);
            const { data, error } = await sb.from('gym_foods').select('meal, name, grams, kcal, protein, carbs, fat, food').eq('user_id', props.user).eq('day', from);
            if (error || !data?.length) { say(error ? error.message : `Nothing logged on ${fmtDay(from).toLowerCase()}`, 'error'); return; }
            if (!(await ask({ title: `Copy ${data.length} item${data.length === 1 ? '' : 's'} from ${fmtDay(from).toLowerCase()}?`, ok: 'Copy', danger: false }))) return;
            const { error: e2 } = await sb.from('gym_foods').insert(data.map(r => ({ ...r, user_id: props.user, day: S.foodsDay })));
            if (e2) { say(e2.message, 'error'); return; }
            loadFoods(S.foodsDay);
        };
        // barcodes: typed, or scanned with the camera where the browser can (Chrome on Android, …)
        const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
        let scanStream = null, scanTimer = null;
        const stopScan = () => { clearInterval(scanTimer); scanStream?.getTracks().forEach(t => t.stop()); scanStream = null; fd.scanning = false; };
        const lookupCode = async (code) => {
            code = String(code || '').replace(/\D/g, ''); if (code.length < 6) { fd.err = 'Type the numbers under the barcode'; return; }
            fd.err = ''; fd.searching = true;
            try {
                const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,brands,nutriments,serving_size`);
                const d = await r.json();
                const f = d?.product ? offFood({ ...d.product, code }) : null;
                if (f) choose(f); else fd.err = 'That barcode isn’t in Open Food Facts yet: use Quick add';
            } catch { fd.err = 'Couldn’t look it up right now'; }
            fd.searching = false;
        };
        const startScan = async () => {
            try {
                fd.scanning = true; fd.err = '';
                scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                const v = document.getElementById('gym-scan'); if (!v) { stopScan(); return; }
                v.srcObject = scanStream; await v.play();
                const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
                scanTimer = setInterval(async () => { try { const [b] = await det.detect(v); if (b?.rawValue) { stopScan(); fd.code = b.rawValue; lookupCode(b.rawValue); } } catch { /* next frame */ } }, 350);
            } catch { stopScan(); fd.err = 'The camera didn’t open (allow it, or type the barcode)'; }
        };
        watch(() => fd.open, (o) => { if (!o) stopScan(); });

        // targets + the calculator (Mifflin-St Jeor; protein 2 g per kg, 25% of calories from fat, the rest carbs)
        const tg = reactive({ open: false, calc: false });
        const calcResult = computed(() => {
            const p = S.settings.profile, w = toKg(calcWeight.value) || weights.value[weights.value.length - 1]?.weight || 75;
            const bmr = 10 * w + 6.25 * num(p.height) - 5 * num(p.age) + (p.sex === 'f' ? -161 : 5);
            const tdee = bmr * num(p.activity || 1.55), kcal = Math.round((tdee + (p.goal === 'cut' ? -500 : p.goal === 'bulk' ? 300 : 0)) / 10) * 10;
            const prot = Math.round(w * (p.goal === 'cut' ? 2.2 : 2)), fat = Math.round(kcal * 0.25 / 9), carbs = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
            return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, p: prot, c: carbs, f: fat };
        });
        const calcWeight = ref('');
        const useCalc = () => { const r = calcResult.value; Object.assign(S.settings.targets, { kcal: r.kcal, p: r.p, c: r.c, f: r.f }); saveSettings(); tg.calc = false; say('Targets set'); };

        // ---------- tools ----------
        const orm = reactive({ w: '', r: '' });
        const ormValue = computed(() => e1rm(num(orm.w), num(orm.r)));
        const ormTable = computed(() => { const m = ormValue.value; if (!m) return []; return [[100, 1], [95, 2], [93, 3], [90, 4], [87, 5], [85, 6], [80, 8], [75, 10], [70, 12], [65, 15]].map(([p, r]) => ({ p, r, w: Math.round(m * p / 100 * 2) / 2 })); });
        const plate = reactive({ target: '' });
        const plateResult = computed(() => {
            const t = num(plate.target), bar = num(S.settings.bar) || (lb.value ? 45 : 20); if (!t) return null;
            if (t < bar) return { err: `Less than the bar (${bar} ${unit.value})` };
            let side = (t - bar) / 2; const out = [];
            const plates = lb.value ? [45, 35, 25, 10, 5, 2.5] : (S.settings.plates || [25, 20, 15, 10, 5, 2.5, 1.25]);
            for (const p of plates) { while (side >= p - 1e-9) { out.push(p); side -= p; } }
            return { side: out, rest: r1(side * 2), bar };
        });
        const warmups = computed(() => { const w = num(plate.target); if (!w) return []; return [[40, 10], [60, 5], [75, 3], [90, 1]].map(([p, r]) => ({ p, r, w: Math.round(w * p / 100 / (lb.value ? 5 : 2.5)) * (lb.value ? 5 : 2.5) })); });

        // ---------- settings window ----------
        const sett = reactive({ open: false });

        return {
            GYM_TABS, GYM_MUSCLES, GYM_DAYS, GYM_MEALS, GYM_TEMPLATES, GYM_ACTIVITY, S, tab, unit, lb, show, showW, setUnits, saveSettings, fmtDay, fmtDate, fmtDur, clock, num, r1,
            exInfo, fieldLabel, isWeighted, lastText, prevOf, setText, active, elapsed, startWorkout, todayRoutine, addSet, removeSet, moveEx, removeEx, toggleDone, discard, finish, summary,
            deleteWorkout, openWorkout, workoutVol, rest, stopRest, restAdd, picker, openPicker, pickerList, usedCount, pickEx, addCustom,
            editR, openRoutine, saveRoutine, deleteRoutine, moveREx, setDay, weekOrder, routineName, applyTemplate,
            prog, loggedExercises, progSessions, progKind, prs, progChart, thisWeek, weeks, muscleSets, streak, heat,
            today, weightIn, logWeight, weights, weightChart, bodyStats, bodyRange, water, addWater, saveDay, dstr,
            goDay, totals, todayTotals, mealFoods, mealKcal, pctOf, fd, openFood, basicHits, recentHits, choose, chooseRecent, pickMacros, addPicked, addQuick, removeFood, copyYesterday,
            canScan, startScan, stopScan, lookupCode, tg, calcResult, calcWeight, useCalc, orm, ormValue, ormTable, plate, plateResult, warmups, sett, e1rm,
        };
    },
    template: '#gym-template',
};
