// Placeholder content from the ElMaster design prototype. Used when Supabase
// is not configured (demo mode), and mirrored in supabase/seed.sql.
import type { Area, Catalog, Course, Exam, LiveClass, Lesson, QuizQuestion, UserState } from './types';

const LEARN: Record<Area, string[]> = {
  Mathematics: ['Build intuition for divisibility, primes and modular arithmetic', 'Solve olympiad problems with invariants and extremal arguments', 'Write clean, rigorous proofs examiners love', 'Pace yourself through 3-hour papers'],
  Science: ['Master the core concepts with visual, first-principles explanations', 'Tackle multi-step numericals with confidence', 'Learn the experimental reasoning olympiads test', 'Practise with 400+ graded problems'],
  Coding: ['Think in algorithms: greedy, DP, graphs', 'Write fast, bug-free C++ under time pressure', 'Analyse complexity like a judge', 'Simulate real contest rounds'],
  Languages: ['Command grammar, usage and vocabulary', 'Read closely and answer precisely', 'Write with clarity and style', 'Ace comprehension under the clock'],
  Humanities: ['Think like an economist about everyday choices', 'Read graphs, data and policy', 'Debate trade-offs with evidence', 'Prepare for commerce olympiads'],
};

type RawCourse = Omit<Course, 'desc' | 'learn'>;

const RAW: RawCourse[] = [
  { id: 'imo', num: '01', sym: 'Nt', title: 'Olympiad Mathematics: Number Theory', subject: 'Number Theory', area: 'Mathematics', tags: ['Olympiad', 'Mathematics'], instructor: 'Dr. Ananya Rao', role: 'IMO Silver · IISc Bangalore', price: 2499, mrp: 4999, rating: 4.9, reviews: '2.1k', students: '12.4k', lessons: 48, hours: 22, level: 'Advanced', grade: 'Grade 8–12', cover: '#0A1F4D', ink: '#3DD6CF', pop: 98 },
  { id: 'phy', num: '02', sym: 'Ph', title: 'Physics Olympiad: Mechanics from First Principles', subject: 'Mechanics', area: 'Science', tags: ['Olympiad', 'Science'], instructor: 'Prof. Vikram Sethi', role: 'Former IPhO coach · IIT Delhi', price: 2999, mrp: 5499, rating: 4.8, reviews: '1.6k', students: '9.1k', lessons: 42, hours: 19, level: 'Advanced', grade: 'Grade 9–12', cover: '#0B4FB3', ink: '#D4E5FF', pop: 91 },
  { id: 'chem', num: '03', sym: 'Ch', title: 'Organic Chemistry, Illuminated', subject: 'Chemistry', area: 'Science', tags: ['Science', 'Competitive'], instructor: 'Dr. Meera Iyer', role: 'Author · 18 yrs teaching', price: 1999, mrp: 3499, rating: 4.7, reviews: '1.2k', students: '7.8k', lessons: 36, hours: 16, level: 'Intermediate', grade: 'Grade 11–12', cover: '#0F9D8F', ink: '#EEF0FB', pop: 80 },
  { id: 'bio', num: '04', sym: 'Bi', title: 'Biology Olympiad Foundations', subject: 'Biology', area: 'Science', tags: ['Olympiad', 'Science'], instructor: 'Dr. Kavya Nair', role: 'IBO mentor · AIIMS', price: 1799, mrp: 2999, rating: 4.8, reviews: '940', students: '6.3k', lessons: 30, hours: 14, level: 'Beginner', grade: 'Grade 6–10', cover: '#17A673', ink: '#EEF0FB', pop: 76 },
  { id: 'cs', num: '05', sym: 'Cs', title: 'Informatics Olympiad: Algorithms in C++', subject: 'Algorithms', area: 'Coding', tags: ['Olympiad', 'Coding'], instructor: 'Arjun Menon', role: 'IOI Bronze · Google', price: 3499, mrp: 6999, rating: 4.9, reviews: '1.8k', students: '6.2k', lessons: 54, hours: 28, level: 'Advanced', grade: 'Grade 8–12', cover: '#6B4EFF', ink: '#3DD6CF', pop: 94 },
  { id: 'eng', num: '06', sym: 'En', title: 'English Olympiad: Grammar & Usage', subject: 'English', area: 'Languages', tags: ['Olympiad', 'Languages'], instructor: "Sarah D'Souza", role: 'Cambridge CELTA · 12 yrs', price: 999, mrp: 1999, rating: 4.6, reviews: '3.4k', students: '15k', lessons: 28, hours: 11, level: 'Beginner', grade: 'Grade 6–10', cover: '#0172EA', ink: '#EEF5FF', pop: 88 },
  { id: 'jee', num: '07', sym: 'Al', title: 'JEE Foundation: Algebra', subject: 'Algebra', area: 'Mathematics', tags: ['Competitive', 'Mathematics'], instructor: 'Rohit Bansal', role: 'JEE AIR 42 · IIT Bombay', price: 3999, mrp: 7999, rating: 4.8, reviews: '4.2k', students: '21k', lessons: 60, hours: 32, level: 'Intermediate', grade: 'Grade 9–11', cover: '#E5484D', ink: '#D4E5FF', pop: 96 },
  { id: 'astro', num: '08', sym: 'As', title: 'Astronomy Olympiad: The Night Sky', subject: 'Astronomy', area: 'Science', tags: ['Olympiad', 'Science'], instructor: 'Dr. Neel Kapoor', role: 'Astrophysicist · IUCAA', price: 1499, mrp: 2499, rating: 4.7, reviews: '610', students: '3.9k', lessons: 24, hours: 10, level: 'Intermediate', grade: 'Grade 8–12', cover: '#123A80', ink: '#EEF0FB', pop: 70 },
  { id: 'eco', num: '09', sym: 'Ec', title: 'Economics for Curious Minds', subject: 'Economics', area: 'Humanities', tags: ['Humanities'], instructor: 'Priya Raman', role: 'LSE · Policy researcher', price: 1299, mrp: 1999, rating: 4.6, reviews: '480', students: '2.7k', lessons: 20, hours: 8, level: 'Beginner', grade: 'Grade 9–12', cover: '#3DD6CF', ink: '#0A1F4D', pop: 62 },
  { id: 'geo', num: '10', sym: 'Gm', title: 'Geometry for Olympiads', subject: 'Geometry', area: 'Mathematics', tags: ['Olympiad', 'Mathematics'], instructor: 'Dr. Ananya Rao', role: 'IMO Silver · IISc Bangalore', price: 2299, mrp: 3999, rating: 4.9, reviews: '1.1k', students: '8.6k', lessons: 40, hours: 18, level: 'Intermediate', grade: 'Grade 7–12', cover: '#EEF0FB', ink: '#0B4FB3', pop: 85 },
];

export const COURSES: Course[] = RAW.map((c) => ({
  ...c,
  desc: `${c.title} is a carefully sequenced course by ${c.instructor}. Every lesson pairs a short, beautifully produced video with worked examples and graded practice — built for students who want depth, not shortcuts.`,
  learn: LEARN[c.area],
}));

const NT_LESSONS = ['Why number theory?', 'Divisibility & primes', 'GCD and Euclid’s algorithm', 'Modular arithmetic', 'Fermat’s little theorem', 'Chinese remainder theorem', 'Diophantine equations', 'Problem set: Week 2'];
const NT_DUR = ['08:20', '18:45', '21:10', '24:00', '19:30', '26:15', '22:40', '35:00'];
const GENERIC = ['Welcome & course map', 'Foundations', 'Core techniques', 'Worked examples', 'Problem-solving patterns', 'Olympiad-level practice', 'Full mock & review', 'Problem set: Week 2'];

export const LESSONS: Lesson[] = COURSES.flatMap((c) =>
  (c.id === 'imo' ? NT_LESSONS : GENERIC).map((title, i) => ({
    id: `${c.id}-${i + 1}`,
    courseId: c.id,
    position: i,
    title,
    duration: NT_DUR[i],
  })),
);

export const QUIZ: QuizQuestion[] = [
  { q: 'What is the remainder when 2¹⁰⁰ is divided by 7?', o: ['1', '2', '4', '6'], a: 1 },
  { q: 'How many positive divisors does 360 have?', o: ['18', '20', '24', '30'], a: 2 },
  { q: 'A convex polygon has interior angles summing to 1440°. How many sides does it have?', o: ['8', '9', '10', '12'], a: 2 },
  { q: 'If x + 1/x = 3, what is x² + 1/x²?', o: ['5', '7', '9', '11'], a: 1 },
  { q: 'What is the last digit of 7²⁰²⁶?', o: ['1', '3', '7', '9'], a: 3 },
];

export const EXAMS: Exam[] = [
  { id: 'emo', name: 'Elden Mathematics Olympiad', date: '2026-11-16', meta: 'Grades 6–12 · Online · ₹149' },
  { id: 'nso', name: 'National Science Olympiad — Level 1', date: '2026-12-04', meta: 'Grades 6–12 · School centre · ₹125' },
  { id: 'ieo', name: 'International English Olympiad', date: '2026-12-12', meta: 'Grades 6–12 · Online · ₹125' },
  { id: 'eic', name: 'Elden Informatics Challenge', date: '2027-01-10', meta: 'Grades 8–12 · Online · Free' },
  { id: 'nao', name: 'National Astronomy Olympiad', date: '2027-01-25', meta: 'Grades 9–12 · Centre · ₹200' },
];

/** EMO: the featured olympiad. Registrations close a month before the exam. */
export const FEATURED_EXAM = { id: 'emo', startsAt: '2026-11-16T09:00:00+05:30', regClosesAt: '2026-10-16T23:59:00+05:30' };

function at(daysFromToday: number, h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function demoLiveClasses(): LiveClass[] {
  return [
    { id: 'g1', title: 'Geometry Masterclass: Circles & Power of a Point', host: 'Dr. Ananya Rao', startsAt: new Date(Date.now() - 42 * 60000).toISOString(), isLive: true, watching: 1284 },
    { id: 'p1', title: 'Physics Doubt Clinic: Rotational Motion', host: 'Prof. Vikram Sethi', startsAt: at(0, 20, 0), isLive: false },
    { id: 'p2', title: 'Parents’ Webinar: Choosing the Right Olympiad', host: 'ElMaster Admissions', startsAt: at(1, 17, 30), isLive: false },
    { id: 'p3', title: 'EMO Strategy Session — The Last 30 Days', host: 'Team ElMaster', startsAt: at(6, 11, 0), isLive: false },
  ];
}

export function demoCatalog(): Catalog {
  return { courses: COURSES, lessons: LESSONS, exams: EXAMS, liveClasses: demoLiveClasses(), quiz: QUIZ };
}

/** What a brand-new signed-in student starts with. */
export const EMPTY_USER: UserState = {
  profile: { name: '', grade: 'Grade 10', goals: [] },
  onboarded: false,
  cart: [],
  wish: [],
  owned: [],
  progress: {},
  currentLesson: {},
  reg: [],
  remind: [],
  notes: [],
  remindOn: true,
  readAll: false,
  lastOrder: [],
};

/** The demo student from the prototype, used in demo mode. */
export const DEMO_USER: UserState = {
  profile: { name: 'Aarav Mehta', grade: 'Grade 10', goals: ['Olympiads', 'School exams'] },
  onboarded: false,
  cart: ['phy'],
  wish: ['cs', 'astro'],
  owned: ['imo', 'eng', 'chem'],
  progress: { imo: 29, eng: 72, chem: 100 },
  currentLesson: { imo: 3 },
  reg: ['nso'],
  remind: ['p1'],
  notes: [{ id: 'n0', courseId: 'imo', lessonId: 'imo-4', at: '06:12', text: 'aᵖ ≡ a (mod p) — check base case p ∤ a first.' }],
  remindOn: true,
  readAll: false,
  lastOrder: [],
};

// Static showcase content (leaderboard, mocks, papers, medals, reviews,
// notifications). These are placeholders until the admin dashboard feeds them.
export const REVIEWS = [
  { i: 'IK', n: 'Ishaan K.', m: 'Grade 11 · EMO Gold', t: 'The problem sets are perfectly graded. I went from Level 1 to the national round in one season.' },
  { i: 'SM', n: 'Sunita M.', m: 'Parent', t: 'My daughter actually looks forward to these lessons. Clear, calm and rigorous.' },
  { i: 'RA', n: 'Rehan A.', m: 'Grade 9', t: 'Loved the worked examples — feels like a great book that talks back.' },
];

export const MOCKS = [
  { icon: 'bolt', t: 'Number Theory Sprint', meta: '5 Qs · 10 min · Level 1', best: '—' },
  { icon: 'quiz', t: 'EMO Full Mock #3', meta: '35 Qs · 60 min · Level 2', best: '82%' },
  { icon: 'science', t: 'NSO Physics Mock', meta: '25 Qs · 45 min', best: '74%' },
  { icon: 'change_history', t: 'Geometry Speed Round', meta: '15 Qs · 20 min', best: '91%' },
];

export const LEADERBOARD = [
  { r: 1, i: 'IK', n: 'Ishaan K.', s: 2980 },
  { r: 2, i: 'DM', n: 'Diya M.', s: 2915 },
  { r: 3, i: 'KS', n: 'Kabir S.', s: 2870 },
  { r: 4, i: 'AP', n: 'Ananya P.', s: 2810 },
  { r: 5, i: 'RA', n: 'Rehan A.', s: 2765 },
  { r: 6, i: 'MJ', n: 'Meher J.', s: 2702 },
  { r: 7, i: 'TV', n: 'Tanvi V.', s: 2688 },
];
export const MY_RANK = { r: 128, s: 2140 };

export const PAPERS = [
  { yy: '25', t: 'EMO 2025 · Level 1', meta: 'Paper + full solutions · 2.4 MB' },
  { yy: '25', t: 'NSO 2025 · Class 10', meta: 'Paper + answer key · 1.8 MB' },
  { yy: '24', t: 'EMO 2024 · Level 2', meta: 'Paper + video solutions' },
  { yy: '24', t: 'IEO 2024 · Class 9', meta: 'Paper + answer key · 1.2 MB' },
  { yy: '23', t: 'EMO 2023 · Level 1', meta: 'Paper + full solutions · 2.1 MB' },
];

export const MEDALS: { kind: 'gold' | 'silver' | 'bronze' | 'merit' | 'lock'; l: string; s: string }[] = [
  { kind: 'gold', l: 'EMO 2025', s: 'Gold' },
  { kind: 'silver', l: 'NSO 2025', s: 'Silver' },
  { kind: 'bronze', l: 'IEO 2024', s: 'Bronze' },
  { kind: 'merit', l: '30-day streak', s: 'Merit' },
  { kind: 'lock', l: 'EIC 2026', s: 'Locked' },
  { kind: 'lock', l: 'INAO 2027', s: 'Locked' },
];
