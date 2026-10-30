// Vercel Function entry: every /api/* request is rewritten here (see vercel.json).
import { createApp } from '../server/app.js';
import { getDeps } from '../server/deps.js';

const app = createApp(getDeps);
const handle = (req: Request) => app.fetch(req);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
