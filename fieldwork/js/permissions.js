// Interface permissions mirror db/migrations/20261118_members_roles.sql.
// The database remains authoritative; hiding a control does not grant access.
export const ROLES = Object.freeze(['owner', 'admin', 'manager', 'accountant', 'worker', 'viewer']);
export const ROLE_OPTIONS = Object.freeze([
  { value: 'owner', label: 'Owner', description: 'Full workspace control, including owners and administrators.' },
  { value: 'admin', label: 'Administrator', description: 'Workspace and team administration; cannot change owners or administrators.' },
  { value: 'manager', label: 'Manager', description: 'Farm operations, people and finances within assigned farms.' },
  { value: 'accountant', label: 'Accountant', description: 'Finances, vendors, worker pay and financial reports.' },
  { value: 'worker', label: 'Worker', description: 'Tasks, checklist runs and field records; no finances or pay.' },
  { value: 'viewer', label: 'Viewer', description: 'Read operational information and operational reports.' },
]);
const ALL = new Set(ROLES);
const FINANCE = new Set(['owner', 'admin', 'manager', 'accountant']);
const MANAGE = new Set(['owner', 'admin', 'manager']);
const OPERATE = new Set(['owner', 'admin', 'manager', 'worker']);
const OP_READ = new Set(['owner', 'admin', 'manager', 'worker', 'viewer']);
const moduleKey = (key) => ({ finance: 'finances', transactions: 'finances', budgets: 'finances',
  closing: 'finances', recurring: 'finances', categories: 'finances', bills: 'finances',
  tasks: 'daily', checklists: 'daily', enterprises: 'livestock', crops: 'livestock',
  projects: 'infrastructure', payroll: 'finances', audit: 'audit', team: 'members' }[key] || key);

export function canManageMembers(role) { return role === 'owner' || role === 'admin'; }
export function canManageMember(role, targetRole, nextRole = targetRole) {
  if (role === 'owner') return ROLES.includes(nextRole);
  return role === 'admin' && !['owner', 'admin'].includes(targetRole) && !['owner', 'admin'].includes(nextRole) && ROLES.includes(nextRole);
}
export function canReadModule(role, key) {
  if (!ALL.has(role)) return false;
  switch (moduleKey(key)) {
    case 'overview': case 'farms': case 'workers': case 'infrastructure': case 'reports': case 'settings': case 'account': return true;
    case 'daily': case 'livestock': return OP_READ.has(role);
    case 'finances': case 'vendors': case 'funding': case 'audit': return FINANCE.has(role);
    case 'members': return canManageMembers(role);
    default: return false;
  }
}
export function canWriteModule(role, key) {
  switch (moduleKey(key)) {
    case 'daily': case 'livestock': return OPERATE.has(role);
    case 'finances': case 'vendors': case 'workers': return FINANCE.has(role);
    case 'farms': case 'infrastructure': case 'funding': return MANAGE.has(role);
    case 'members': case 'settings': return canManageMembers(role);
    default: return false;
  }
}
export function has(role, capability) {
  switch (capability) {
    case 'finance.read': case 'finance.write': case 'pay.read': case 'pay.write': case 'audit.read': return FINANCE.has(role);
    case 'members.manage': case 'workspace.manage': return canManageMembers(role);
    case 'workspace.delete': return role === 'owner';
    case 'operations.read': return OP_READ.has(role);
    case 'operations.write': return OPERATE.has(role);
    case 'operations.templates': case 'farm.manage': return MANAGE.has(role);
    case 'reports.read': return ALL.has(role);
    default: return false;
  }
}
export const canReport = canReadModule;
export function canAccessFarm(membership, farmId) {
  if (!membership) return false;
  if (['owner', 'admin'].includes(membership.role) || membership.farm_scope !== 'farms') return true;
  return Boolean(farmId) && (membership.farm_ids || []).includes(farmId);
}
