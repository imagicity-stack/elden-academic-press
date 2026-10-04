import 'server-only';
import { demoCatalog } from './seed';
import { getServerSupabase } from './supabase/server';
import type { Catalog, Course } from './types';

/**
 * Loads the public catalog. Reads Supabase when configured and seeded,
 * otherwise falls back to the built-in placeholder catalog.
 */
export async function loadCatalog(): Promise<Catalog> {
  const supabase = await getServerSupabase();
  if (!supabase) return demoCatalog();

  const [courses, lessons, exams, live, quiz] = await Promise.all([
    supabase.from('courses').select('*').order('num'),
    supabase.from('lessons').select('*').order('position'),
    supabase.from('exams').select('*').order('exam_date'),
    supabase.from('live_classes').select('*').order('starts_at'),
    supabase.from('quiz_questions').select('*').eq('mock_id', 'nt-sprint').order('position'),
  ]);

  const err = courses.error ?? lessons.error ?? exams.error ?? live.error ?? quiz.error;
  if (err) {
    console.error('[catalog] Supabase read failed, using demo catalog:', err.message);
    return demoCatalog();
  }
  if (!courses.data?.length) return demoCatalog();

  return {
    courses: courses.data.map(
      (r): Course => ({
        id: r.id, num: r.num, sym: r.sym, title: r.title, subject: r.subject, area: r.area, tags: r.tags,
        instructor: r.instructor, role: r.role, price: r.price, mrp: r.mrp, rating: Number(r.rating),
        reviews: r.reviews, students: r.students, lessons: r.lessons, hours: r.hours, level: r.level,
        grade: r.grade, cover: r.cover, ink: r.ink, pop: r.pop, desc: r.description, learn: r.learn,
      }),
    ),
    lessons: (lessons.data ?? []).map((r) => ({ id: r.id, courseId: r.course_id, position: r.position, title: r.title, duration: r.duration })),
    exams: (exams.data ?? []).map((r) => ({ id: r.id, name: r.name, date: r.exam_date, meta: r.meta })),
    liveClasses: (live.data ?? []).map((r) => ({ id: r.id, title: r.title, host: r.host, startsAt: r.starts_at, isLive: r.is_live, watching: r.watching })),
    quiz: (quiz.data ?? []).map((r) => ({ q: r.question, o: r.options, a: r.answer })),
  };
}
