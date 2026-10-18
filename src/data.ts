// Placeholder catalogue content from the design — titles, authors, prices,
// ISBNs, distributors and contact details are all sample data.

export interface Palette { bg: string; fg: string; ac: string }

export const PAL: Palette[] = [
  { bg: '#0E1F33', fg: '#F6F0E6', ac: '#CC955F' },
  { bg: '#6B3A0A', fg: '#FBF1E3', ac: '#E7BE92' },
  { bg: '#E8DAC3', fg: '#0E1F33', ac: '#87561F' },
  { bg: '#9C6A2F', fg: '#FFF8EE', ac: '#0E1F33' },
  { bg: '#1E3A57', fg: '#F6F0E6', ac: '#E2B68A' },
  { bg: '#F3EDE3', fg: '#6B3A0A', ac: '#0E1F33' },
];

export type LevelKey = 'P' | 'M' | 'S' | 'SS' | 'C' | 'H';

export const LV: Record<LevelKey, string> = {
  P: 'Primary (Class 1–5)',
  M: 'Middle (Class 6–8)',
  S: 'Secondary (Class 9–10)',
  SS: 'Senior Secondary (11–12)',
  C: 'Competitive exams',
  H: 'Higher ed & research',
};

export const LVS: Record<LevelKey, string> = {
  P: 'Primary', M: 'Middle', S: 'Secondary', SS: 'Senior Sec.', C: 'Competitive', H: 'Higher ed',
};

export type BookType = 'Textbook' | 'Reference' | 'Study Guide' | 'Practice Papers' | 'Workbook' | 'Journal';

export interface Book {
  id: string;
  /** Title */
  t: string;
  /** Series */
  s: string;
  /** Author / editor */
  a: string;
  ty: BookType;
  lv: LevelKey;
  /** Class, exam or volume label */
  cl: string;
  /** Board ('' for exam/scholarly titles) */
  bd: string;
  su: string;
  /** Print price (INR) */
  pr: number;
  /** Price suffix, e.g. ' / year' for journal subscriptions */
  per?: string;
  /** E-book price (0 = print only) */
  eb: number;
  pg: number;
  /** Index into PAL for the cover */
  p: number;
  nw: boolean;
  /** Has an elmaster digital companion */
  em: boolean;
  /** Blurb */
  bl: string;
}

const b = (x: Omit<Book, 'nw' | 'em'> & { nw: 0 | 1; em: 0 | 1 }): Book => ({ ...x, nw: !!x.nw, em: !!x.em });

export const BOOKS: Book[] = [
  b({ id: 'm8', t: 'Mathematics Today', s: 'Elden Core', a: 'Dr. Ritu Malhotra', ty: 'Textbook', lv: 'M', cl: 'Class 8', bd: 'CBSE', su: 'Mathematics', pr: 395, eb: 249, pg: 312, p: 0, nw: 1, em: 1, bl: 'A concept-first course that moves from worked examples to exam-style problems, aligned to the latest NCERT syllabus.' }),
  b({ id: 'neet', t: 'NEET Biology: Chapterwise PYQs', s: 'Elden Competitive', a: 'Dr. Kavita Rao', ty: 'Practice Papers', lv: 'C', cl: 'NEET', bd: '', su: 'Biology', pr: 625, eb: 399, pg: 540, p: 1, nw: 1, em: 1, bl: 'Ten years of NEET questions sorted by chapter and difficulty, with explanations written for self-study.' }),
  b({ id: 'phy11', t: 'Physics: Concepts & Problems', s: 'Elden Advanced', a: 'Prof. Arvind Sethi', ty: 'Reference', lv: 'SS', cl: 'Class 11', bd: 'CBSE', su: 'Physics', pr: 545, eb: 349, pg: 620, p: 4, nw: 1, em: 1, bl: 'Rigorous theory with graded problem sets that bridge the board syllabus and JEE preparation.' }),
  b({ id: 'sci6', t: 'Foundations of Science', s: 'Elden Core', a: 'Anand Iyer & Sana Kapoor', ty: 'Textbook', lv: 'M', cl: 'Class 6', bd: 'CBSE', su: 'Science', pr: 360, eb: 229, pg: 248, p: 2, nw: 1, em: 1, bl: 'Hands-on activities and everyday examples that build scientific curiosity from the first chapter.' }),
  b({ id: 'cuet', t: 'CUET (UG) General Test Guide', s: 'Elden Competitive', a: 'Elden Editorial Board', ty: 'Study Guide', lv: 'C', cl: 'CUET', bd: '', su: 'General Aptitude', pr: 475, eb: 299, pg: 420, p: 3, nw: 1, em: 1, bl: 'Complete coverage of the General Test — reasoning, quantitative aptitude and current affairs — with mock papers.' }),
  b({ id: 'evs3', t: 'Our World: Environmental Studies', s: 'Little Elden', a: 'Meera Joshi', ty: 'Textbook', lv: 'P', cl: 'Class 3', bd: 'ICSE', su: 'EVS', pr: 275, eb: 0, pg: 136, p: 5, nw: 0, em: 0, bl: 'A colourful introduction to family, plants, animals and community, with activity pages in every lesson.' }),
  b({ id: 'eng4', t: 'English Grammar Practice', s: 'Little Elden', a: 'Rachel D’Souza', ty: 'Workbook', lv: 'P', cl: 'Class 4', bd: 'CBSE', su: 'English', pr: 220, eb: 0, pg: 120, p: 1, nw: 0, em: 0, bl: 'Short, focused exercises on grammar and usage that children can complete independently.' }),
  b({ id: 'mm2', t: 'Mental Maths Workbook', s: 'Little Elden', a: 'Sunil Verma', ty: 'Workbook', lv: 'P', cl: 'Class 2', bd: 'State Boards', su: 'Mathematics', pr: 180, eb: 0, pg: 96, p: 3, nw: 0, em: 0, bl: 'Daily practice sheets that build number sense and speed — one page a day across the year.' }),
  b({ id: 'hin7', t: 'Hindi Vyakaran Abhyas', s: 'Elden Core', a: 'Dr. Pooja Tiwari', ty: 'Workbook', lv: 'M', cl: 'Class 7', bd: 'CBSE', su: 'Hindi', pr: 210, eb: 149, pg: 144, p: 0, nw: 0, em: 0, bl: 'Grammar exercises with clear rules and examples, aligned to the CBSE Hindi course.' }),
  b({ id: 'ss10', t: 'Social Science Revision Notes', s: 'Elden Exam Edge', a: 'Nikhil Bhatt', ty: 'Study Guide', lv: 'S', cl: 'Class 10', bd: 'CBSE', su: 'Social Science', pr: 299, eb: 179, pg: 232, p: 4, nw: 0, em: 1, bl: 'Chapter summaries, maps, timelines and likely questions for fast, focused board revision.' }),
  b({ id: 'sp10', t: 'Sample Papers: Science & Maths', s: 'Elden Exam Edge', a: 'Elden Editorial Board', ty: 'Practice Papers', lv: 'S', cl: 'Class 10', bd: 'CBSE', su: 'Science', pr: 349, eb: 199, pg: 288, p: 1, nw: 1, em: 1, bl: 'Fifteen full sample papers in the latest board pattern with marking schemes and examiner tips.' }),
  b({ id: 'oc12', t: 'Organic Chemistry, Simplified', s: 'Elden Advanced', a: 'Dr. Farhan Qureshi', ty: 'Reference', lv: 'SS', cl: 'Class 12', bd: 'CBSE', su: 'Chemistry', pr: 495, eb: 299, pg: 410, p: 5, nw: 0, em: 1, bl: 'Reaction mechanisms explained visually, with practice built for boards, JEE and NEET.' }),
  b({ id: 'cs12', t: 'Computer Science with Python', s: 'Elden Core', a: 'Ankita Desai', ty: 'Textbook', lv: 'SS', cl: 'Class 12', bd: 'CBSE', su: 'Computer Science', pr: 425, eb: 269, pg: 356, p: 2, nw: 0, em: 1, bl: 'Python, data handling and databases taught through projects, following the CBSE course.' }),
  b({ id: 'jee', t: 'JEE Main: 20 Full Mock Tests', s: 'Elden Competitive', a: 'Elden Editorial Board', ty: 'Practice Papers', lv: 'C', cl: 'JEE Main', bd: '', su: 'Physics', pr: 575, eb: 349, pg: 480, p: 0, nw: 0, em: 1, bl: 'Twenty full-length tests in the current JEE Main pattern with detailed, step-by-step solutions.' }),
  b({ id: 'upsc', t: 'Indian Polity for Civil Services', s: 'Elden Competitive', a: 'R. S. Krishnan', ty: 'Reference', lv: 'C', cl: 'UPSC', bd: '', su: 'General Studies', pr: 595, eb: 379, pg: 640, p: 3, nw: 0, em: 0, bl: 'The Constitution, institutions and governance explained for Prelims and Mains, with practice questions.' }),
  b({ id: 'rme', t: 'Research Methods in Education', s: 'Elden Scholarly', a: 'Prof. Lata Narayanan', ty: 'Reference', lv: 'H', cl: 'B.Ed / M.Ed', bd: '', su: 'Education', pr: 895, eb: 599, pg: 384, p: 4, nw: 0, em: 0, bl: 'A practical guide to designing, conducting and reporting educational research in Indian contexts.' }),
  b({ id: 'jer', t: 'Elden Journal of Educational Research', s: 'Journal', a: 'Ed. Prof. Lata Narayanan', ty: 'Journal', lv: 'H', cl: 'Vol. 4 · Issue 2', bd: '', su: 'Education', pr: 1200, per: ' / year', eb: 0, pg: 168, p: 0, nw: 1, em: 0, bl: 'A peer-reviewed biannual on pedagogy, assessment and policy in Indian school and higher education.' }),
  b({ id: 'jasp', t: 'Journal of Science Pedagogy', s: 'Journal', a: 'Ed. Dr. Arjun Mehta', ty: 'Journal', lv: 'H', cl: 'Vol. 2 · Issue 1', bd: '', su: 'Science', pr: 950, per: ' / year', eb: 0, pg: 124, p: 1, nw: 0, em: 0, bl: 'Research and classroom practice in science and mathematics teaching, from primary to university.' }),
];

export const TYPES: BookType[] = ['Textbook', 'Reference', 'Study Guide', 'Practice Papers', 'Workbook', 'Journal'];
export const SUBJECTS = [...new Set(BOOKS.map((x) => x.su))].sort();
export const BOARDS = ['CBSE', 'ICSE', 'State Boards'];
export const FORMATS = ['Print', 'E-book'];

export interface Resource { id: string; t: string; k: string; lv: LevelKey; su: string; size: string }

export const RES: Resource[] = ([
  ['Class 10 Science — Sample Paper Set 1', 'Sample papers', 'S', 'Science', '2.4 MB'],
  ['Class 10 Mathematics (Standard) — Sample Paper Set 1', 'Sample papers', 'S', 'Mathematics', '1.9 MB'],
  ['Class 12 Physics — Sample Paper with Marking Scheme', 'Sample papers', 'SS', 'Physics', '3.1 MB'],
  ['NEET Biology — Quick Revision: Human Physiology', 'Revision notes', 'C', 'Biology', '4.6 MB'],
  ['Mathematics Today, Class 8 — Chapter-wise Answer Key', 'Answer keys', 'M', 'Mathematics', '1.2 MB'],
  ['JEE Main — Formula Sheet: Mechanics', 'Revision notes', 'C', 'Physics', '0.8 MB'],
  ['Class 6 Science — Activity Worksheets', 'Worksheets', 'M', 'Science', '2.0 MB'],
  ['Class 3 EVS — Activity Sheets', 'Worksheets', 'P', 'EVS', '3.3 MB'],
  ['Class 4 English Grammar — Practice Worksheets', 'Worksheets', 'P', 'English', '1.4 MB'],
  ['Class 10 Social Science — Map Work Practice', 'Revision notes', 'S', 'Social Science', '2.7 MB'],
  ['CBSE Class 9–10 Syllabus 2026–27', 'Syllabus', 'S', 'All subjects', '1.1 MB'],
  ['CUET (UG) General Test — Pattern & Syllabus', 'Syllabus', 'C', 'General Aptitude', '0.6 MB'],
  ['Organic Chemistry, Simplified — Errata (2nd ed.)', 'Errata', 'SS', 'Chemistry', '0.3 MB'],
] as [string, string, LevelKey, string, string][]).map((r, i) => ({ id: 'r' + i, t: r[0], k: r[1], lv: r[2], su: r[3], size: r[4] }));

export const HUB_KINDS = ['All', 'Sample papers', 'Revision notes', 'Answer keys', 'Worksheets', 'Syllabus', 'Errata'];
export const HUB_LEVELS: ('All' | LevelKey)[] = ['All', 'P', 'M', 'S', 'SS', 'C'];

export interface Distributor { n: string; c: string; k: string }

export const DIST: Record<string, Distributor[]> = {
  'Delhi NCR': [{ n: 'Capital Book Distributors', c: 'Daryaganj, New Delhi', k: 'Wholesale' }, { n: 'Scholars’ Corner', c: 'Sector 18, Noida', k: 'Retail & schools' }, { n: 'Aravali Educational Supplies', c: 'Gurugram', k: 'School supply' }],
  Maharashtra: [{ n: 'Deccan Academic Books', c: 'Appa Balwant Chowk, Pune', k: 'Wholesale' }, { n: 'Western Book House', c: 'Dadar, Mumbai', k: 'Retail & schools' }],
  'Uttar Pradesh': [{ n: 'Awadh Book Agency', c: 'Aminabad, Lucknow', k: 'Wholesale' }, { n: 'Sangam Educational', c: 'Civil Lines, Prayagraj', k: 'Retail & coaching' }],
  Karnataka: [{ n: 'Garden City Booksellers', c: 'Avenue Road, Bengaluru', k: 'Wholesale' }],
  'Tamil Nadu': [{ n: 'Coromandel Book Traders', c: 'Parrys, Chennai', k: 'Wholesale' }, { n: 'Kovai School Books', c: 'R.S. Puram, Coimbatore', k: 'School supply' }],
  'West Bengal': [{ n: 'College Street Educational', c: 'College Street, Kolkata', k: 'Wholesale' }],
  Bihar: [{ n: 'Patliputra Book Centre', c: 'Ashok Rajpath, Patna', k: 'Wholesale & coaching' }],
  Rajasthan: [{ n: 'Pink City Book Depot', c: 'Chaura Rasta, Jaipur', k: 'Wholesale' }, { n: 'Kota Aspirants’ Store', c: 'Talwandi, Kota', k: 'Coaching supply' }],
};

const CONTENTS: Record<string, string[]> = {
  m8: ['Rational Numbers', 'Linear Equations in One Variable', 'Understanding Quadrilaterals', 'Data Handling', 'Squares and Square Roots', 'Cubes and Cube Roots', 'Comparing Quantities', 'Algebraic Expressions and Identities', 'Mensuration', 'Exponents and Powers', 'Direct and Inverse Proportions', 'Factorisation'],
  'Practice Papers': ['How to use this book', 'Exam pattern & marking scheme', 'Papers 1–5 with solutions', 'Papers 6–10 with solutions', 'Previous years’ papers', 'Examiner’s tips & common errors'],
  Journal: ['Editorial', 'Research articles', 'Short communications', 'Classroom practice notes', 'Book reviews', 'Call for papers'],
  Textbook: ['Getting started', 'Core concepts', 'Worked examples', 'Activities & projects', 'Exercises', 'Glossary & answers'],
  _: ['Chapter summaries', 'Key terms & formulae', 'Solved examples', 'Practice exercises', 'Self-assessment tests', 'Answers & hints'],
};

export const contentsFor = (bk: Book) => CONTENTS[bk.id] || CONTENTS[bk.ty] || CONTENTS._;

const HL: Record<BookType, string[]> = {
  Textbook: ['Syllabus-aligned chapters with learning outcomes', 'Worked examples before every exercise', 'Activities, projects and competency-based questions', 'Teacher’s manual for adopting schools'],
  Reference: ['In-depth theory beyond the textbook', 'Graded problems from basic to advanced', 'Previous years’ exam questions', 'Quick-revision summaries per chapter'],
  'Study Guide': ['Concise chapter summaries', 'Important questions with model answers', 'Mind maps and quick-revision tables', 'Practice tests in exam pattern'],
  'Practice Papers': ['Papers in the latest exam pattern', 'Detailed step-by-step solutions', 'Marking scheme and time-management tips', 'Online mock tests on elmaster'],
  Workbook: ['One concept per page', 'Graded exercises for independent practice', 'Answer key at the back', 'Perforated sheets for classroom use'],
  Journal: ['Double-blind peer review', 'Open to submissions year-round', 'Print and online editions', 'Indexed with DOI for every article'],
};

export const highlightsFor = (bk: Book) => HL[bk.ty] || HL.Textbook;

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

export const bookMeta = (bk: Book) => [bk.cl, bk.bd].filter(Boolean).join(' · ');
export const bookPrice = (bk: Book) => inr(bk.pr) + (bk.per || '');
export const findBook = (id: string | undefined) => BOOKS.find((x) => x.id === id);

export const specsFor = (bk: Book) => {
  const bi = BOOKS.indexOf(bk);
  return [
    ['ISBN', '978-93-' + (48210 + bi * 37) + '-' + (bi % 9) + '-' + ((bi * 7) % 10)],
    ['Pages', String(bk.pg)],
    ['Edition', '2026–27'],
    [bk.bd ? 'Board' : 'Exam / series', bk.bd || bk.cl],
    ['Level', LV[bk.lv]],
    ['Language', bk.id === 'hin7' ? 'Hindi' : 'English'],
  ];
};

export const relatedTo = (bk: Book) =>
  BOOKS.filter((x) => x.id !== bk.id && (x.lv === bk.lv || x.su === bk.su))
    .concat(BOOKS.filter((x) => x.id !== bk.id && x.ty === bk.ty))
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, 5);
