export type Area = 'Mathematics' | 'Science' | 'Coding' | 'Languages' | 'Humanities';
export type Level = 'Beginner' | 'Intermediate' | 'Advanced';

export interface Course {
  id: string;
  num: string;
  sym: string;
  title: string;
  subject: string;
  area: Area;
  tags: string[];
  instructor: string;
  role: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: string;
  students: string;
  lessons: number;
  hours: number;
  level: Level;
  grade: string;
  cover: string;
  ink: string;
  pop: number;
  desc: string;
  learn: string[];
}

export interface Lesson {
  id: string;
  courseId: string;
  position: number;
  title: string;
  duration: string;
}

export interface QuizQuestion {
  q: string;
  o: string[];
  a: number;
}

export interface Exam {
  id: string;
  name: string;
  date: string; // ISO date
  meta: string;
}

export interface LiveClass {
  id: string;
  title: string;
  host: string;
  startsAt: string; // ISO
  isLive: boolean;
  watching?: number;
}

export interface Catalog {
  courses: Course[];
  lessons: Lesson[];
  exams: Exam[];
  liveClasses: LiveClass[];
  quiz: QuizQuestion[];
}

export interface Note {
  id: string;
  courseId: string;
  lessonId: string;
  at: string;
  text: string;
}

export interface Profile {
  name: string;
  grade: string;
  goals: string[];
  phone?: string;
}

export interface UserState {
  profile: Profile;
  onboarded: boolean;
  cart: string[];
  wish: string[];
  owned: string[];
  progress: Record<string, number>;
  currentLesson: Record<string, number>;
  reg: string[];
  remind: string[];
  notes: Note[];
  remindOn: boolean;
  readAll: boolean;
  lastOrder: string[];
}
