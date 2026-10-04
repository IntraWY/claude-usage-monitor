import test from "node:test";
import assert from "node:assert/strict";
import {archiveAccount, restoreAccount, defaultProfiles, archivedAccounts, aggregateAccounts} from "../src/profiles.mjs";
test("Delete all merged channels, retain sign-in profiles and persist suppression of automatic local discovery", () => {
  const profiles = [{id:"claude-local",provider:"Claude",kind:"cli"},{id:"web",provider:"Claude",partition:"persist:test"},{id:"codex-local",provider:"Codex"}];
  const account = {id:"Claude:user:org",email:"person@example.com",sourceProfiles:["claude-local","web"]};
  const plan = archiveAccount(profiles, [], account);
  assert.deepEqual(plan.profiles, [profiles[2]]);
  const saved = JSON.parse(JSON.stringify(plan));
  assert.deepEqual(defaultProfiles(saved.profiles, saved.removedProfiles), [profiles[2]]);
  assert.deepEqual(archivedAccounts(plan.removedProfiles), [{id:account.id,provider:"Claude",email:account.email}]);
  const restored = restoreAccount(saved.profiles, saved.removedProfiles, account.id);
  assert.deepEqual(restored.profiles.slice(1), profiles.slice(0,2));
  assert.equal(restored.removedProfiles.length, 0);
  assert.throws(() => archiveAccount(plan.profiles, plan.removedProfiles, account), /ไม่พบบัญชี/);
});
test("In-flight results for removed channels cannot resurrect accounts or contaminate another channel's quotas", () => {
  const make = (id, used) => ({id,provider:"Claude",identity:"user",workspace:"org",state:"connected",email:null,sourceProfiles:[id],channels:[id],models:[],quotas:[{id:"5h",used}]});
  const results = [["cli",make("cli",95)],["web",make("web",12)]];
  assert.equal(aggregateAccounts(results, []).size, 0);
  const a = [...aggregateAccounts(results, [{id:"web"}]).values()][0];
  assert.equal(a.quotas[0].used, 12);
  assert.deepEqual(a.sourceProfiles,["web"]);
  assert.deepEqual(a.channels,["web"]);
});
test("Restoring an archived Codex profile preserves its isolated sign-in home and does not duplicate active profiles", () => {
  const p={id:"codex-profile",provider:"Codex",home:"/app/profiles/codex-profile"};
  const plan=archiveAccount([p],[],{id:p.id,sourceProfiles:[p.id]});
  assert.deepEqual(restoreAccount([p],plan.removedProfiles,p.id).profiles,[p]);
});
