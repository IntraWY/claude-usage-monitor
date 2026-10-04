import { mergeAccount } from "./domain.mjs";
export function archiveAccount(profiles, removedProfiles, account) {
  if (!account) throw new Error("ไม่พบบัญชี");
  const ids = new Set(account.sourceProfiles || [account.id]);
  const removed = profiles.filter(p => ids.has(p.id));
  if (!removed.length) throw new Error("ไม่พบบัญชี");
  return {
    profiles: profiles.filter(p => !ids.has(p.id)),
    removedProfiles: [...removedProfiles, ...removed.map(p => ({ ...p, removedAccountId: account.id, removedEmail: account.email || null }))],
    removed,
  };
}
export function restoreAccount(profiles, removedProfiles, id) {
  const removed = removedProfiles.filter(p => p.removedAccountId === id);
  if (!removed.length) throw new Error("ไม่พบบัญชี");
  return {
    profiles: [...profiles, ...removed.filter(p => !profiles.some(x => x.id === p.id)).map(({ removedAccountId, removedEmail, ...p }) => p)],
    removedProfiles: removedProfiles.filter(p => p.removedAccountId !== id),
  };
}
export function defaultProfiles(profiles, removedProfiles) {
  const defaults = [{ id: "claude-local", provider: "Claude", kind: "cli" }, { id: "codex-local", provider: "Codex" }];
  return [...defaults.filter(p => ![...profiles, ...removedProfiles].some(x => x.id === p.id)), ...profiles];
}
export function archivedAccounts(removedProfiles) {
  return [...new Map(removedProfiles.map(p => [p.removedAccountId, { id: p.removedAccountId, provider: p.provider, email: p.removedEmail || null }])).values()];
}

export function aggregateAccounts(results, profiles) {
  const active = new Set(profiles.map(p => p.id)), next = new Map();
  for (const [profileId, value] of results) {
    if (!active.has(profileId)) continue;
    let a = value;
    if (a.identity) {
      a = { ...a, id: a.provider === "Codex" ? `${a.provider}:${a.identity}` : `${a.provider}:${a.identity}:${a.workspace || ""}` };
      a = mergeAccount(next.get(a.id), a);
    }
    next.set(a.id, a);
  }
  return next;
}
