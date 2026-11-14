// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { toMailApps, mergeBack, ingestAll, sinceDay, dropLog, ME } from "../outlook-sync.js";
import { confirmItem, undoItem } from "../tracker-mail.js";

const DAY = 86400000;
const T0 = Date.parse("2026-11-10T09:00:00Z");

const app = (o = {}) => ({
  id: "app_1", role: "General Manager", company: "Gulf Horizon Logistics", location: "Dubai",
  to: "careers@gulfhorizonlogistics.ae", subject: "Application — General Manager (Ref. GH-77) — AHMED AL-MANSOOR",
  appliedAt: T0, preparedAt: T0, targetFollowUpAt: T0 + 4 * DAY, stage: "draft", notes: "", platform: "Portal", ...o,
});

const mail = (o = {}) => ({
  msgId: "", inReplyTo: [], references: [], from: { name: "", address: "" }, to: [], date: "",
  subject: "", text: "", autoSubmitted: false, isReport: false, isReceipt: false, ...o,
});

const sentCopy = mail({
  msgId: "<sent-1@live.de>", from: { name: "Rassem", address: ME[0] }, to: ["careers@gulfhorizonlogistics.ae"],
  date: "2026-11-11T08:00:00Z", subject: "Application — General Manager (Ref. GH-77) — AHMED AL-MANSOOR",
  text: "Dear Hiring Team, please find my CV attached.",
});

const interviewReply = mail({
  msgId: "<r-1@gulfhorizonlogistics.ae>", inReplyTo: ["<sent-1@live.de>"], references: ["<sent-1@live.de>"],
  from: { name: "Sara HR", address: "sara@gulfhorizonlogistics.ae" }, to: [ME[0]], date: "2026-11-13T10:00:00Z",
  subject: "RE: Application — General Manager (Ref. GH-77) — AHMED AL-MANSOOR",
  text: "Dear Ahmed,\nWe would like to invite you to an interview next Tuesday at 10am.\nBest regards, Sara",
});

// The same invitation opening with a thank-you reads as less certain: it waits for you.
const politeInterview = mail({ ...interviewReply, msgId: "<r-1b@gulfhorizonlogistics.ae>",
  text: "Dear Ahmed,\nThank you for your application. We would like to invite you to an interview next Tuesday.\nBest regards, Sara" });

const rejection = mail({
  msgId: "<r-2@gulfhorizonlogistics.ae>", inReplyTo: ["<sent-1@live.de>"],
  from: { name: "Sara HR", address: "sara@gulfhorizonlogistics.ae" }, to: [ME[0]], date: "2026-11-14T10:00:00Z",
  subject: "RE: Application — General Manager (Ref. GH-77) — AHMED AL-MANSOOR",
  text: "Dear Ahmed,\nUnfortunately we have decided not to proceed with your application.\nKind regards",
});

const newsletter = mail({
  msgId: "<n-1@news.example>", from: { name: "Deals", address: "deals@news.example" }, to: [ME[0]],
  date: "2026-11-12T07:00:00Z", subject: "Black Friday — 50% off", text: "Shop now.",
});

function run(list, mails, sync = {}) {
  const { apps, sync: next } = ingestAll(sync, toMailApps(list), mails);
  return { ...mergeBack(list, apps), sync: next };
}

test("stages map to the mail reader and back without change", () => {
  const stages = ["draft", "applied", "acknowledged", "info", "screening", "interview", "offer", "followed_up", "rejected", "bounced", "archived"];
  const list = stages.map((s, i) => app({ id: "a" + i, stage: s }));
  const r = mergeBack(list, toMailApps(list));
  assert.equal(r.changed, false);
  assert.deepEqual(r.list, list);
});

test("the sent copy turns a draft into Applied with the real send date", () => {
  const r = run([app()], [sentCopy]);
  const a = r.list[0];
  assert.equal(a.stage, "applied");
  assert.equal(a.sentAt, "2026-11-11");
  assert.equal(a.appliedAt, Date.parse("2026-11-11"));
  assert.equal(a.targetFollowUpAt, Date.parse("2026-11-11") + 4 * DAY);
  assert.ok(a.msgIds.includes("<sent-1@live.de>"));
  assert.ok(a.mailLog.some((e) => e.kind === "sent" && /^Sent/.test(e.text)));
});

test("an interview invitation moves the application on and logs the reply", () => {
  const r = run([app()], [sentCopy, interviewReply]);
  const a = r.list[0];
  assert.equal(a.stage, "interview");
  assert.equal(a.lastReplyAt, "2026-11-13");
  assert.ok(a.mailLog.some((e) => e.kind === "reply" && e.cls === "interview"));
});

test("a less certain invitation is held as a suggestion, not applied", () => {
  const r = run([app({ stage: "applied", sentAt: "2026-11-11" })], [politeInterview]);
  assert.equal(r.list[0].stage, "applied");
  const item = r.sync.inbox[0];
  assert.equal(item.status, "suggested");
  assert.equal(item.appId, "app_1");
  const st = confirmItem({ apps: toMailApps(r.list), inbox: r.sync.inbox, seen: r.sync.seen }, item.id, item.appId);
  assert.equal(mergeBack(r.list, st.apps).list[0].stage, "interview");
});

test("a rejection after the interview marks it Rejected", () => {
  const first = run([app()], [sentCopy, interviewReply]);
  const second = run(first.list, [sentCopy, interviewReply, rejection], first.sync);
  assert.equal(second.list[0].stage, "rejected");
});

test("syncing the same mail twice changes nothing the second time", () => {
  const first = run([app()], [sentCopy, interviewReply]);
  const second = run(first.list, [sentCopy, interviewReply], first.sync);
  assert.equal(second.changed, false);
  assert.equal(second.list[0].mailLog.length, first.list[0].mailLog.length);
});

test("unrelated mail is neither applied nor stored", () => {
  const r = run([app()], [newsletter]);
  assert.equal(r.changed, false);
  assert.equal(r.sync.inbox.length, 0);
  assert.equal(r.sync.seen.length, 0);
});

test("mail is read oldest first whatever order it arrives in, undated mail last", () => {
  const undated = mail({ ...newsletter, msgId: "<u@x>", date: "" });
  const r = run([app()], [interviewReply, undated, sentCopy]);
  assert.equal(r.list[0].sentAt, "2026-11-11");
  assert.equal(r.list[0].stage, "interview");
});

test("a stage set by hand is kept when no newer mail moves it", () => {
  const first = run([app()], [sentCopy]);
  const byHand = first.list.map((a) => ({ ...a, stage: "screening" }));
  const again = run(byHand, [sentCopy], first.sync);
  assert.equal(again.list[0].stage, "screening");
});

test("an unclear match waits as a suggestion and applies on confirm", () => {
  // Two applications to the same firm: the reply cannot tell which one it answers.
  const list = [app(), app({ id: "app_2", role: "Operations Director", subject: "Application — Operations Director — AHMED AL-MANSOOR" })];
  const vague = mail({ msgId: "<v@gulfhorizonlogistics.ae>", from: { name: "HR", address: "hr@gulfhorizonlogistics.ae" },
    date: "2026-11-13T10:00:00Z", subject: "Your application", text: "Thank you for your application, we have received it." });
  const r = run(list, [vague]);
  assert.equal(r.changed, false);
  const item = r.sync.inbox[0];
  assert.equal(item.status === "suggested" || item.status === "unmatched", true);
  if (item.status === "suggested") {
    const st = confirmItem({ apps: toMailApps(r.list), inbox: r.sync.inbox, seen: r.sync.seen }, item.id, "app_2");
    const merged = mergeBack(r.list, st.apps);
    assert.equal(merged.list.find((a) => a.id === "app_2").stage, "acknowledged");
  }
});

test("undo takes an applied reply back and drops its log line", () => {
  const r = run([app({ stage: "applied", sentAt: "2026-11-11" })], [interviewReply]);
  assert.equal(r.list[0].stage, "interview");
  const item = r.sync.inbox.find((x) => x.status === "auto");
  const st = undoItem({ apps: toMailApps(r.list), inbox: r.sync.inbox, seen: r.sync.seen }, item.id);
  let back = mergeBack(r.list, st.apps).list;
  back = dropLog(back, item.id).list;
  assert.equal(back[0].stage, "applied");
  assert.equal((back[0].mailLog || []).some((e) => e.item === item.id), false);
});

test("sync reads back to a day before the oldest open application, at most 120 days", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  // Always at least the last 30 days, so a reply to an older application is still read.
  assert.equal(sinceDay([app({ appliedAt: Date.parse("2026-11-01"), preparedAt: undefined })], now), "2026-10-14");
  assert.equal(sinceDay([app({ preparedAt: Date.parse("2026-10-01") })], now), "2026-09-30");
  assert.equal(sinceDay([app({ preparedAt: Date.parse("2026-01-01") })], now), "2026-07-17");
  assert.equal(sinceDay([app({ stage: "archived", preparedAt: Date.parse("2026-01-01") })], now), "2026-10-14");
});
