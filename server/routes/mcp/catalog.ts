// Every tool the Claude connector offers, and which of them a role sees.
import type { Role } from '../admin/auth.js';
import { BACKEND_TOOLS } from './backend.js';
import { TOOLS, type Tool } from './tools.js';

export const ALL_TOOLS: Tool[] = [...TOOLS, ...BACKEND_TOOLS];

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };
export const toolsFor = (role: Role) => ALL_TOOLS.filter((t) => RANK[role] >= RANK[t.role ?? 'staff']);
