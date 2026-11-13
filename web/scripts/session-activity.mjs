import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const sessions = await sql`
  select id, label, username, status, created_at
  from alignment_sessions
  order by created_at desc
  limit 100
`;
console.log("SESSIONS", sessions.length);
console.log(sessions);

const aligns = await sql`
  select session_id, count(*)::int as n, max(created_at) as last
  from alignments
  where session_id is not null
  group by session_id
  order by last desc nulls last
`;
console.log("ALIGNMENTS_BY_SESSION", aligns);

const drafts = await sql`
  select a.session_id, s.label, s.username, count(*)::int as links, max(a.created_at) as last_edit
  from alignments a
  join alignment_sessions s on s.id = a.session_id
  where a.session_id is not null and a.superseded_by_id is null
  group by a.session_id, s.label, s.username
  order by last_edit desc nulls last
`;
console.log("ACTIVE_SESSION_EDITS", drafts);

const subs = await sql`
  select sv.session_id, s.label, s.username, count(*)::int as submitted, max(sv.submitted_at) as last_submit
  from session_verse_submissions sv
  join alignment_sessions s on s.id = sv.session_id
  group by sv.session_id, s.label, s.username
  order by last_submit desc nulls last
`;
console.log("SUBMISSIONS", subs);

const recentAlign = await sql`
  select a.id, a.session_id, s.label, s.username, a.verse_id, a.created_at
  from alignments a
  left join alignment_sessions s on s.id = a.session_id
  where a.session_id is not null
  order by a.created_at desc
  limit 20
`;
console.log("RECENT_SESSION_ALIGN_ROWS", recentAlign);
